/**
 * StructurePass — GPU-rendered structures with icon sprites.
 *
 * Renders a filled circle in player color with a white icon overlay,
 * sampled from a pre-built 6-column sprite atlas (generate-sprite-atlases.mjs).
 *
 * Three LODs based on zoom:
 *   - zoom >= structure.spriteZoom (zfront): a pixel-art sprite of the
 *     building itself (building-sprites.png, drawn by
 *     scripts/sprites/buildingSprites.ts), tinted with the owner's colour
 *     where its mask says so; the HQ is drawn this way too
 *   - zoom > dotsZoomThreshold: full icon with circle background
 *   - below that: smaller dots (no icon detail)
 *
 * One instanced draw call per frame.
 *
 * Data flow:
 *   FrameSnapshot.units → filter structures → instance VBO → GPU
 */

import type { GhostPreviewData, RendererConfig, UnitState } from "../../types";
import {
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_MISSILE_SILO,
  UT_OUTPOST,
  UT_PORT,
  UT_SAM_LAUNCHER,
} from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import {
  getPaletteSize,
  MAX_TRAIL_COLORS,
  STRUCTURES_EFFECT_BLOCK,
} from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";

import { assetUrl } from "@openfront/shared/AssetUrls";
import structureFragSrc from "../shaders/structure/structure.frag.glsl?raw";
import structureVertSrc from "../shaders/structure/structure.vert.glsl?raw";

const iconAtlasUrl = assetUrl("atlases/icon-atlas.png");
const spriteAtlasUrl = assetUrl("atlases/building-sprites.png");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Structure types in atlas column order.
 * Index = atlas column index.
 */
const STRUCTURE_ORDER = [
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
  UT_OUTPOST,
] as const;

const ATLAS_COLS = STRUCTURE_ORDER.length;

/**
 * zfront: sprite atlas frames: STRUCTURE_ORDER, then the HQ (which is not a
 * unit; it is drawn at the HQ tile the horde frame gives).
 */
const SPRITE_COLS = ATLAS_COLS + 1;
const HQ_COL = ATLAS_COLS;
/** Frames that have a sprite: all but the SAM Launcher (none in horde mode). */
const SPRITE_MASK =
  ((1 << SPRITE_COLS) - 1) & ~(1 << STRUCTURE_ORDER.indexOf(UT_SAM_LAUNCHER));

// ---------------------------------------------------------------------------
// Instance data layout
// ---------------------------------------------------------------------------

// Per-instance: x, y, ownerID, underConstruction, atlasIdx, markedForDeletion
const FLOATS_PER_INSTANCE = 6;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

// ---------------------------------------------------------------------------
// StructurePass
// ---------------------------------------------------------------------------

export class StructurePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private localPlayerID = 0;

  private uLocalPlayerID: WebGLUniformLocation;
  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uIconSize: WebGLUniformLocation;
  private uDotsThreshold: WebGLUniformLocation;
  private uDotScale: WebGLUniformLocation;
  private uScaleFactor: WebGLUniformLocation;
  private uIconGrowZoom: WebGLUniformLocation;
  private uShapeScales: WebGLUniformLocation;
  private uIconFills: WebGLUniformLocation;
  private uGhostAlpha: WebGLUniformLocation;
  private uOutlineColor: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uHighlightMask: WebGLUniformLocation;
  private uHighlightOutlineW: WebGLUniformLocation;
  private uHighlightDimAlpha: WebGLUniformLocation;
  private uFillDarken: WebGLUniformLocation;
  private uBorderDarken: WebGLUniformLocation;
  private uIconAlpha: WebGLUniformLocation;
  private uIconColor: WebGLUniformLocation;
  private uIconDarken: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uHoverOwner: WebGLUniformLocation;
  private uSpriteZoom: WebGLUniformLocation;
  private uSpriteScale: WebGLUniformLocation;
  // Anchored at construction so the uniform stays small (float32 precision).
  private readonly startTime = performance.now();
  /** smallID of the hovered territory's owner (0 = none) — gates the effect. */
  private hoverOwner = 0;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private ghostInstanceBuf: WebGLBuffer;

  private paletteTex: WebGLTexture;
  private effectTex: WebGLTexture;
  private atlasTex: WebGLTexture;
  private spriteTex: WebGLTexture;
  /** zfront: the HQ's tile, drawn as a sprite (-1 = none). */
  private hqTile = -1;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  private instanceCount = 0;

  /** unitType string → atlas column index (0–5) */
  private typeToAtlasCol = new Map<string, number>();
  private mapW: number;

  /** Build-button hover highlight: bitmask of atlas columns (0 = off). */
  private highlightMask = 0;

  /** Ghost preview state (null = no ghost). */
  private ghost: GhostPreviewData | null = null;
  /** Scratch buffer for the single ghost instance (avoids allocation). */
  private ghostBuf = new Float32Array(FLOATS_PER_INSTANCE);

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    paletteTex: WebGLTexture,
    effectTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;
    this.paletteTex = paletteTex;
    this.effectTex = effectTex;

    // Build unitType string → atlas column mapping
    for (let i = 0; i < header.unitTypes.length; i++) {
      const col = STRUCTURE_ORDER.indexOf(
        header.unitTypes[i] as (typeof STRUCTURE_ORDER)[number],
      );
      if (col >= 0) {
        this.typeToAtlasCol.set(header.unitTypes[i], col);
      }
    }

    // Compile shaders
    this.program = createProgram(
      gl,
      shaderSrc(structureVertSrc, { ATLAS_COLS, SPRITE_COLS, HQ_COL }),
      shaderSrc(structureFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ATLAS_COLS,
        // First row of the structures block in the shared effect palette.
        STRUCT_EFFECT_ROW_BASE: STRUCTURES_EFFECT_BLOCK * MAX_TRAIL_COLORS,
      }),
      "StructurePass",
    );
    this.uLocalPlayerID = gl.getUniformLocation(
      this.program,
      "uLocalPlayerID",
    )!;
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uIconSize = gl.getUniformLocation(this.program, "uIconSize")!;
    this.uDotScale = gl.getUniformLocation(this.program, "uDotScale")!;
    this.uDotsThreshold = gl.getUniformLocation(
      this.program,
      "uDotsThreshold",
    )!;
    this.uScaleFactor = gl.getUniformLocation(this.program, "uScaleFactor")!;
    this.uIconGrowZoom = gl.getUniformLocation(this.program, "uIconGrowZoom")!;
    this.uShapeScales = gl.getUniformLocation(this.program, "uShapeScales")!;
    this.uIconFills = gl.getUniformLocation(this.program, "uIconFills")!;
    this.uGhostAlpha = gl.getUniformLocation(this.program, "uGhostAlpha")!;
    this.uOutlineColor = gl.getUniformLocation(this.program, "uOutlineColor")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uHighlightMask = gl.getUniformLocation(
      this.program,
      "uHighlightMask",
    )!;
    this.uHighlightOutlineW = gl.getUniformLocation(
      this.program,
      "uHighlightOutlineW",
    )!;
    this.uHighlightDimAlpha = gl.getUniformLocation(
      this.program,
      "uHighlightDimAlpha",
    )!;
    this.uFillDarken = gl.getUniformLocation(this.program, "uFillDarken")!;
    this.uBorderDarken = gl.getUniformLocation(this.program, "uBorderDarken")!;
    this.uIconAlpha = gl.getUniformLocation(this.program, "uIconAlpha")!;
    this.uIconColor = gl.getUniformLocation(this.program, "uIconColor")!;
    this.uIconDarken = gl.getUniformLocation(this.program, "uIconDarken")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uHoverOwner = gl.getUniformLocation(this.program, "uHoverOwner")!;
    this.uSpriteZoom = gl.getUniformLocation(this.program, "uSpriteZoom")!;
    this.uSpriteScale = gl.getUniformLocation(this.program, "uSpriteScale")!;

    // Texture unit bindings + ghost defaults
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uEffect"), 3);
    gl.uniform1f(this.uGhostAlpha, 1.0);
    gl.uniform3f(this.uOutlineColor, 0, 0, 0);
    gl.uniform1i(this.uHighlightMask, 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSprites"), 4);
    gl.uniform1i(
      gl.getUniformLocation(this.program, "uSpriteMask"),
      SPRITE_MASK,
    );
    gl.uniform2f(gl.getUniformLocation(this.program, "uSpriteTexSize"), 1, 1);

    // Create placeholder atlas texture (1×1 white pixel)
    // Replaced asynchronously once SVGs load
    this.atlasTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Sprite atlas: a transparent 1x1 until it loads, so buildings draw
    // nothing rather than a white square for the first frames.
    this.spriteTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.spriteTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    // Linear filtering for the sharp pixel-art sampling in the shader.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Start async atlas build
    this.loadAtlas();
    this.loadSprites();

    // --- Instance buffers ---
    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      2048,
      FLOATS_PER_INSTANCE,
    );

    // Separate tiny buffer for ghost (avoids corrupting real instance data)
    this.ghostInstanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, BYTES_PER_INSTANCE, gl.DYNAMIC_DRAW);

    // --- VAO ---
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Attribute 0: unit quad [0,0]→[1,1]
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Attribute 1: per-instance vec4 (x, y, ownerID, underConstruction)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: per-instance vec2 (atlasIdx, markedForDeletion)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  private async loadAtlas(): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = iconAtlasUrl;
    await img.decode();
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
  }

  private async loadSprites(): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = spriteAtlasUrl;
    await img.decode();
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.spriteTex);
    // Premultiplied, so a pixel blends cleanly with its transparent neighbours.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.useProgram(this.program);
    gl.uniform2f(
      gl.getUniformLocation(this.program, "uSpriteTexSize"),
      img.width,
      img.height,
    );
  }

  /** zfront: the HQ's tile from the horde frame (-1 = no HQ). */
  setHq(tile: number): void {
    this.hqTile = tile;
  }

  setLocalPlayer(smallID: number): void {
    this.localPlayerID = smallID;
  }

  /** Hovered territory's owner (0 = none) — shows that player's structures effect. */
  setHighlightOwner(ownerID: number): void {
    this.hoverOwner = ownerID;
  }

  updateStructures(units: Map<number, UnitState>): void {
    let count = 0;

    for (const unit of units.values()) {
      if (!unit.isActive) continue;
      const atlasIdx = this.typeToAtlasCol.get(unit.unitType);
      if (atlasIdx === undefined) continue;

      this.instanceBuf.ensureCapacity(count + 1);

      const off = count * FLOATS_PER_INSTANCE;
      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;

      this.instanceBuf.float32[off + 0] = x;
      this.instanceBuf.float32[off + 1] = y;
      this.instanceBuf.float32[off + 2] = unit.ownerID;
      this.instanceBuf.float32[off + 3] = unit.underConstruction ? 1 : 0;
      this.instanceBuf.float32[off + 4] = atlasIdx;
      this.instanceBuf.float32[off + 5] =
        unit.markedForDeletion !== false ? 1 : 0;

      count++;
    }

    this.instanceCount = count;

    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        count * FLOATS_PER_INSTANCE,
      );
    }
  }

  updateGhostPreview(data: GhostPreviewData | null): void {
    this.ghost = data;
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }

  /** Highlight structures of the given types (null/empty = off). Dims all other types. */
  setHighlightTypes(unitTypes: string[] | null): void {
    let mask = 0;
    if (unitTypes) {
      for (const t of unitTypes) {
        const col = this.typeToAtlasCol.get(t);
        if (col !== undefined) mask |= 1 << col;
      }
    }
    this.highlightMask = mask;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    const hasGhost =
      this.ghost !== null && this.typeToAtlasCol.has(this.ghost.ghostType);
    const hasHq =
      this.hqTile >= 0 && zoom >= this.settings.structure.spriteZoom;
    if (this.instanceCount === 0 && !hasGhost && !hasHq) return;

    const gl = this.gl;
    gl.useProgram(this.program);

    const ss = this.settings.structure;
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uLocalPlayerID, this.localPlayerID);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uIconSize, ss.iconSize);
    gl.uniform1f(this.uDotsThreshold, ss.dotsZoomThreshold);
    gl.uniform1f(this.uDotScale, ss.dotScale);
    gl.uniform1f(this.uScaleFactor, ss.iconScaleFactorZoomedOut);
    gl.uniform1f(this.uIconGrowZoom, ss.iconGrowZoom);
    gl.uniform1f(this.uSpriteZoom, ss.spriteZoom);
    gl.uniform1f(this.uSpriteScale, ss.spriteScale);

    // Build per-structure uniform arrays from settings, ordered by atlas column
    const scales = new Float32Array(SPRITE_COLS).fill(1);
    const fills = new Float32Array(SPRITE_COLS).fill(1);
    for (let i = 0; i < STRUCTURE_ORDER.length; i++) {
      const cfg = ss.shapes[STRUCTURE_ORDER[i]];
      scales[i] = cfg?.scale ?? 1.0;
      fills[i] = cfg?.iconFill ?? 0.6;
    }
    gl.uniform1fv(this.uShapeScales, scales);
    gl.uniform1fv(this.uIconFills, fills);

    gl.uniform1i(
      this.uAltView,
      this.altView && this.settings.altView.recolorStructures ? 1 : 0,
    );
    gl.uniform1i(this.uHighlightMask, this.highlightMask);
    gl.uniform1f(this.uHighlightOutlineW, ss.highlightOutlineWidth);
    gl.uniform1f(this.uHighlightDimAlpha, ss.highlightDimAlpha);
    gl.uniform1f(this.uFillDarken, ss.fillDarken);
    gl.uniform1f(this.uBorderDarken, ss.borderDarken);
    gl.uniform1f(this.uIconAlpha, ss.iconAlpha);
    gl.uniform3f(this.uIconColor, ss.iconR, ss.iconG, ss.iconB);
    gl.uniform1f(this.uIconDarken, ss.iconDarken);
    // Seconds; drives the structures-effect gradient scroll / transition cycle.
    gl.uniform1f(this.uTime, (performance.now() - this.startTime) / 1000);
    gl.uniform1f(this.uHoverOwner, this.hoverOwner);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTex);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.spriteTex);

    gl.bindVertexArray(this.vao);

    // --- zfront: the HQ, under everything built round it ---
    if (hasHq) {
      const tx = this.hqTile % this.mapW;
      this.drawSingle(tx, (this.hqTile - tx) / this.mapW, HQ_COL);
    }

    // --- Real structures ---
    if (this.instanceCount > 0) {
      gl.uniform1f(this.uGhostAlpha, 1.0);
      gl.uniform3f(this.uOutlineColor, 0, 0, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    }

    // --- Ghost structure (1 translucent instance with outline) ---
    if (hasGhost) {
      const g = this.ghost!;
      const atlasIdx = this.typeToAtlasCol.get(g.ghostType)!;

      // Temporarily rebind instance attrs to ghost buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostInstanceBuf);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);

      // -- Green highlight on existing structure being upgraded --
      if (g.canUpgrade && g.upgradeTargetTile !== null) {
        const tx = g.upgradeTargetTile % this.mapW;
        const ty = (g.upgradeTargetTile - tx) / this.mapW;
        this.ghostBuf[0] = tx;
        this.ghostBuf[1] = ty;
        this.ghostBuf[2] = g.ownerID;
        this.ghostBuf[3] = 0;
        this.ghostBuf[4] = atlasIdx;
        this.ghostBuf[5] = 0;
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ghostBuf);

        gl.uniform1f(this.uGhostAlpha, 0.6);
        gl.uniform3f(this.uOutlineColor, 0.0, 0.8, 0.0); // green highlight
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
      }

      // -- Ghost icon at cursor --
      this.ghostBuf[0] = g.tileX;
      this.ghostBuf[1] = g.tileY;
      this.ghostBuf[2] = g.ownerID;
      this.ghostBuf[3] = 0;
      this.ghostBuf[4] = atlasIdx;
      this.ghostBuf[5] = 0;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ghostBuf);

      gl.uniform1f(this.uGhostAlpha, 0.5);
      if (g.canUpgrade) {
        gl.uniform3f(this.uOutlineColor, 0.0, 0.8, 0.0); // green tint — upgrade
      } else if (g.canBuild) {
        gl.uniform3f(this.uOutlineColor, 0, 0, 0); // no tint — valid build
      } else {
        gl.uniform3f(this.uOutlineColor, 0.8, 0.2, 0.2); // red tint — can't build
      }
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);

      // Restore instance attrs to main buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    }
  }

  /** One instance from the scratch buffer, drawn opaque with no tint. */
  private drawSingle(x: number, y: number, col: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostInstanceBuf);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    this.ghostBuf[0] = x;
    this.ghostBuf[1] = y;
    this.ghostBuf[2] = this.localPlayerID;
    this.ghostBuf[3] = 0;
    this.ghostBuf[4] = col;
    this.ghostBuf[5] = 0;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ghostBuf);
    gl.uniform1f(this.uGhostAlpha, 1.0);
    gl.uniform3f(this.uOutlineColor, 0, 0, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    if (this.ghostInstanceBuf) gl.deleteBuffer(this.ghostInstanceBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.atlasTex);
    gl.deleteTexture(this.spriteTex);
  }
}
