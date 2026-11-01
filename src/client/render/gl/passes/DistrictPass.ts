/**
 * DistrictPass — zfront's buffer districts, drawn over territory and under
 * the horde.
 *
 * The frame carries only the district size and one state byte per
 * district; the pass rebuilds the district map (engine-lib
 * `game/Districts`, from the map's own districts if it has them) once,
 * then on each frame packs, per coarse cell, the
 * state of its district and which sides border another district, uploads
 * that as an R8 texture, and draws it on a map-sized quad: a green wash
 * and outline for Held districts, amber stripes while an Outpost secures
 * one, a red pulse while one is being overrun, a light outline round Core
 * districts and faint lines between Wild ones.
 */

import { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import {
  DistrictMap,
  districtMap,
  MapDistrictIds,
} from "@openfront/engine-lib/game/Districts";
import districtFragSrc from "../shaders/district/district.frag.glsl?raw";
import districtVertSrc from "../shaders/district/district.vert.glsl?raw";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

const EDGE_N = 8;
const EDGE_E = 16;
const EDGE_S = 32;
const EDGE_W = 64;

/**
 * One byte per coarse cell: its district's state in bits 0-2, and bits 3-6
 * set where the north, east, south or west neighbour is in another district.
 */
export function districtCells(
  map: DistrictMap,
  width: number,
  height: number,
  states: Uint8Array,
): Uint8Array {
  const ids = map.ids;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      const d = ids[c];
      let b = (states[d] ?? 0) & 7;
      if (y > 0 && ids[c - width] !== d) b |= EDGE_N;
      if (x + 1 < width && ids[c + 1] !== d) b |= EDGE_E;
      if (y + 1 < height && ids[c + width] !== d) b |= EDGE_S;
      if (x > 0 && ids[c - 1] !== d) b |= EDGE_W;
      out[c] = b;
    }
  }
  return out;
}

export class DistrictPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture | null = null;
  private uCamera: WebGLUniformLocation;
  private uDistricts: WebGLUniformLocation;
  private uGridSize: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private map: DistrictMap | null = null;
  private gridW = 0;
  private gridH = 0;
  /** The states last uploaded, to skip unchanged frames. */
  private last: Uint8Array = new Uint8Array();

  constructor(
    private gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    /** The map's hand-made districts, as the engine got them. */
    private own?: MapDistrictIds,
  ) {
    this.program = createProgram(
      gl,
      shaderSrc(districtVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      districtFragSrc,
      "DistrictPass",
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uDistricts = gl.getUniformLocation(this.program, "uDistricts")!;
    this.uGridSize = gl.getUniformLocation(this.program, "uGridSize")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.vao = createMapQuad(gl, mapW, mapH);
  }

  update(frame: HordeFrame): void {
    if (frame.districtSize <= 0 || frame.districts.length === 0) {
      this.map = null;
      return;
    }
    const gl = this.gl;
    if (
      this.map === null ||
      this.map.size !== frame.districtSize ||
      frame.width !== this.gridW ||
      frame.height !== this.gridH
    ) {
      this.map = districtMap(
        frame.width,
        frame.height,
        frame.districtSize,
        this.own,
      );
      this.gridW = frame.width;
      this.gridH = frame.height;
      if (this.tex) gl.deleteTexture(this.tex);
      this.tex = createTexture2D(gl, {
        width: frame.width,
        height: frame.height,
        internalFormat: gl.R8,
        format: gl.RED,
        type: gl.UNSIGNED_BYTE,
        data: null,
      });
      this.last = new Uint8Array();
    }
    // A frame for some other cut (not possible on one map) is ignored.
    if (frame.districts.length !== this.map.count) return;
    if (sameBytes(this.last, frame.districts)) return;
    this.last = frame.districts.slice();
    const cells = districtCells(
      this.map,
      frame.width,
      frame.height,
      frame.districts,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      frame.width,
      frame.height,
      gl.RED,
      gl.UNSIGNED_BYTE,
      cells,
    );
  }

  draw(cam: Float32Array, timeSec: number): void {
    if (this.map === null || this.tex === null) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cam);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uDistricts, 0);
    gl.uniform2i(this.uGridSize, this.gridW, this.gridH);
    gl.uniform1f(this.uTime, timeSec);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.tex) gl.deleteTexture(this.tex);
    gl.deleteVertexArray(this.vao);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
