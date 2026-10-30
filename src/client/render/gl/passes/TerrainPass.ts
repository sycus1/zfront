/**
 * TerrainPass — renders the terrain map as a textured quad.
 *
 * Initial upload happens once; incremental updates flow through
 * applyTerrainRects() so water-nuke conversions (land → water) are reflected
 * live. Vertex shader transforms the map quad by the camera mat3; fragment
 * shader samples the RGBA8 terrain texture with nearest-neighbour filtering
 * so each terrain cell stays pixel-crisp at every zoom level.
 *
 * zfront: with the horde's coarse grid it bakes the horde palette instead
 * (HordeTerrainColors), and while a wall post is being placed it lights up
 * the solid faces in snap range of the cursor.
 */

import { WALL_SNAP_RADIUS } from "@openfront/engine-lib/game/HordeTerrain";
import type { GhostPreviewData, TerrainRect } from "../../types";
import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";
import {
  buildTerrainRGBA,
  encodeTerrainTile,
  TerrainColorOverrides,
} from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import {
  buildHordeTerrainRGBA,
  HordeTerrainGrid,
} from "../utils/HordeTerrainColors";

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass {
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private uSnapCursor: WebGLUniformLocation;
  private uSnapRadius: WebGLUniformLocation;
  // The wall post's coarse cell centre while one is being placed, else off.
  private snapCursor: [number, number] = [-1, -1];
  private mapW: number;
  private mapH: number;
  // Base ocean (deep water) color; reused by applyTerrainRects and rebuilds.
  private terrainColors: TerrainColorOverrides | undefined;
  // Scratch RGBA buffer for rect sub-uploads; grown as needed and reused
  // across applyTerrainRects calls.
  private rgbaScratch = new Uint8Array(0);

  constructor(
    private gl: WebGL2RenderingContext,
    // Regenerates current per-tile terrain bytes (reflecting water-nuke
    // conversions) for the rare full re-bake in setTerrainColors. A provider
    // instead of a retained buffer: terrain bytes are map-sized (8 MB on the
    // giant map).
    private terrainSource: () => Uint8Array,
    terrainBytes: Uint8Array,
    mapW: number,
    mapH: number,
    terrainColors?: TerrainColorOverrides,
    // zfront: the horde's coarse grid; terrain is coloured by what it means
    // to the horde.
    private hordeGrid?: HordeTerrainGrid,
  ) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.terrainColors = terrainColors;
    this.program = createProgram(
      gl,
      shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderSrc(terrainFragSrc, { MAP_W: mapW, MAP_H: mapH }),
      "TerrainPass",
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uSnapCursor = gl.getUniformLocation(this.program, "uSnapCursor")!;
    this.uSnapRadius = gl.getUniformLocation(this.program, "uSnapRadius")!;

    this.tex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: this.bake(terrainBytes, terrainColors),
      filter: gl.NEAREST, // pixel-crisp at all zoom levels
    });

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /**
   * Replace the base terrain colors and re-upload the whole terrain texture.
   * Called when the user changes the terrain colors in graphics settings.
   */
  setTerrainColors(terrainColors?: TerrainColorOverrides): void {
    this.terrainColors = terrainColors;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.bake(this.terrainSource(), terrainColors),
    );
  }

  private bake(
    terrainBytes: Uint8Array,
    colors: TerrainColorOverrides | undefined,
  ): Uint8Array {
    return this.hordeGrid
      ? buildHordeTerrainRGBA(
          terrainBytes,
          this.mapW,
          this.mapH,
          this.hordeGrid,
          colors,
        )
      : buildTerrainRGBA(terrainBytes, this.mapW, this.mapH, colors);
  }

  /**
   * zfront: while a wall post is being placed, light up the solid faces it
   * could snap to.
   */
  updateGhostPreview(ghost: GhostPreviewData | null): void {
    if (ghost === null || !ghost.buildGrid || ghost.ghostType !== "Wall") {
      this.snapCursor = [-1, -1];
      return;
    }
    // Tile coordinates follow the shader's convention (+0.5 is the centre).
    const cell = (t: number) => Math.floor((t + 0.5) / 2) + 0.5;
    this.snapCursor = [cell(ghost.tileX), cell(ghost.tileY)];
  }

  /**
   * Update terrain regions in-place (e.g. land→water from a water nuke).
   * Each rect's terrain bytes are stored row-major, concatenated in `bytes`
   * in rect order. One texSubImage2D per rect — a massive bomb changes tens
   * of thousands of tiles, so per-tile 1×1 uploads are too slow. A later full
   * re-upload (setTerrainColors) regenerates from terrainSource, whose
   * backing game map already reflects these conversions.
   */
  applyTerrainRects(rects: readonly TerrainRect[], bytes: Uint8Array): void {
    if (rects.length === 0) return;
    // The horde palette shades tiles by their neighbours and cells, so a
    // change re-bakes the whole map (water nukes are rare in horde games).
    if (this.hordeGrid) {
      this.setTerrainColors(this.terrainColors);
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let offset = 0;
    for (const r of rects) {
      const count = r.w * r.h;
      if (this.rgbaScratch.length < count * 4) {
        this.rgbaScratch = new Uint8Array(count * 4);
      }
      for (let i = 0; i < count; i++) {
        encodeTerrainTile(
          bytes[offset + i],
          this.rgbaScratch,
          i * 4,
          this.terrainColors,
        );
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        r.x,
        r.y,
        r.w,
        r.h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.rgbaScratch,
        0,
      );
      offset += count;
    }
  }

  /** Render the terrain. Call with depth test disabled, no blending. */
  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uSnapCursor, this.snapCursor[0], this.snapCursor[1]);
    gl.uniform1f(this.uSnapRadius, WALL_SNAP_RADIUS);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
    // VAO + buffer leak is acceptable on dispose (context is being destroyed)
  }
}
