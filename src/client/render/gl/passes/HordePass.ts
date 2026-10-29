/**
 * HordePass — zfront's zombie horde, drawn over territory.
 *
 * The worker sends the horde as one byte per coarse (map4x) cell. The pass
 * uploads it as an R8 texture each time a new frame arrives and draws it on
 * a map-sized quad: density as a red overlay (linearly filtered into blobs),
 * elites as pulsing markers, an arrow at each place the announced wave
 * comes ashore, pointing at the HQ, and tracers from each turret that is
 * shooting to what it hit.
 *
 * Spike instrumentation: transfer latency, worker encode time and upload
 * time are accumulated on `globalThis.__zfrontHorde` for measurement.
 */

import { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import hordeFragSrc from "../shaders/horde/horde.frag.glsl?raw";
import hordeVertSrc from "../shaders/horde/horde.vert.glsl?raw";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

export interface HordeRenderStats {
  frames: number;
  /** Means over all frames. */
  latencyMs: number;
  encodeMs: number;
  uploadMs: number;
  maxLatencyMs: number;
  maxUploadMs: number;
  /** GPU time of the horde draw (EXT_disjoint_timer_query_webgl2), mean. */
  gpuMs: number;
  gpuSamples: number;
  /** Debug toggle: skip the draw entirely (for baseline frame rates). */
  hidden: boolean;
  alive: number;
  elites: number;
  wave: number;
  hqHp: number;
  hqMaxHp: number;
  reset(): void;
}

function newStats(): HordeRenderStats {
  const s = {
    frames: 0,
    latencyMs: 0,
    encodeMs: 0,
    uploadMs: 0,
    maxLatencyMs: 0,
    maxUploadMs: 0,
    gpuMs: 0,
    gpuSamples: 0,
    hidden: false,
    alive: 0,
    elites: 0,
    wave: 0,
    hqHp: 0,
    hqMaxHp: 0,
    reset() {
      s.frames = 0;
      s.latencyMs = s.encodeMs = s.uploadMs = 0;
      s.maxLatencyMs = s.maxUploadMs = 0;
      s.gpuMs = s.gpuSamples = 0;
    },
  };
  return s;
}

/** Arrows drawn at most; the default wave has 8 landings. */
export const MAX_ARROWS = 8;

/**
 * Arrows for the announced wave: per arrow, its landing cell's centre and
 * the unit direction to the HQ, in coarse cells. Empty once no wave is
 * announced or there is no HQ to point at.
 */
export function waveArrows(frame: HordeFrame): Float32Array {
  const out = new Float32Array(MAX_ARROWS * 4);
  if (frame.outcome !== "playing" || frame.nextWave === 0 || frame.hqCell < 0) {
    return out.subarray(0, 0);
  }
  const w = frame.width;
  const hx = (frame.hqCell % w) + 0.5;
  const hy = Math.floor(frame.hqCell / w) + 0.5;
  let n = 0;
  for (const cell of frame.nextWaveLandings) {
    if (n >= MAX_ARROWS) break;
    const x = (cell % w) + 0.5;
    const y = Math.floor(cell / w) + 0.5;
    const len = Math.hypot(hx - x, hy - y);
    if (len < 1) continue;
    out.set([x, y, (hx - x) / len, (hy - y) / len], n * 4);
    n++;
  }
  return out.subarray(0, n * 4);
}

/** Turret tracers drawn at most; turrets past this fire unseen. */
export const MAX_SHOTS = 32;

/**
 * Tracers for the turrets that fired on the frame's tick: per shot, the
 * turret cell's centre and the target cell's centre, in coarse cells.
 */
export function turretTracers(frame: HordeFrame): Float32Array {
  const shots = frame.turretShots;
  const n = Math.min(MAX_SHOTS, shots.length >> 1);
  const out = new Float32Array(n * 4);
  const w = frame.width;
  for (let k = 0; k < n; k++) {
    const from = shots[2 * k];
    const to = shots[2 * k + 1];
    out.set(
      [
        (from % w) + 0.5,
        Math.floor(from / w) + 0.5,
        (to % w) + 0.5,
        Math.floor(to / w) + 0.5,
      ],
      k * 4,
    );
  }
  return out;
}

export class HordePass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture | null = null;
  private gridW = 0;
  private gridH = 0;
  private uCamera: WebGLUniformLocation;
  private uHorde: WebGLUniformLocation;
  private uGridSize: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uArrows: WebGLUniformLocation;
  private uArrowCount: WebGLUniformLocation;
  private uArrowFinal: WebGLUniformLocation;
  private uShots: WebGLUniformLocation;
  private uShotCount: WebGLUniformLocation;
  private shots = new Float32Array(MAX_SHOTS * 4);
  private shotCount = 0;
  private arrows = new Float32Array(MAX_ARROWS * 4);
  private arrowCount = 0;
  private arrowFinal = false;
  private readonly stats: HordeRenderStats;
  private readonly timerExt: { TIME_ELAPSED_EXT: number } | null;
  private query: WebGLQuery | null = null;

  constructor(
    private gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
  ) {
    this.program = createProgram(
      gl,
      shaderSrc(hordeVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderSrc(hordeFragSrc, { MAX_ARROWS, MAX_SHOTS }),
      "HordePass",
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uHorde = gl.getUniformLocation(this.program, "uHorde")!;
    this.uGridSize = gl.getUniformLocation(this.program, "uGridSize")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uArrows = gl.getUniformLocation(this.program, "uArrows")!;
    this.uArrowCount = gl.getUniformLocation(this.program, "uArrowCount")!;
    this.uArrowFinal = gl.getUniformLocation(this.program, "uArrowFinal")!;
    this.uShots = gl.getUniformLocation(this.program, "uShots")!;
    this.uShotCount = gl.getUniformLocation(this.program, "uShotCount")!;
    this.vao = createMapQuad(gl, mapW, mapH);
    const g = globalThis as { __zfrontHorde?: HordeRenderStats };
    this.stats = g.__zfrontHorde ??= newStats();
    this.timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  update(frame: HordeFrame): void {
    const gl = this.gl;
    const latency = performance.timeOrigin + performance.now() - frame.sentAt;
    const start = performance.now();
    if (
      this.tex === null ||
      frame.width !== this.gridW ||
      frame.height !== this.gridH
    ) {
      if (this.tex) gl.deleteTexture(this.tex);
      this.gridW = frame.width;
      this.gridH = frame.height;
      this.tex = createTexture2D(gl, {
        width: frame.width,
        height: frame.height,
        internalFormat: gl.R8,
        format: gl.RED,
        type: gl.UNSIGNED_BYTE,
        data: null,
        filter: gl.LINEAR,
      });
    }
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
      frame.cells,
    );
    const arrows = waveArrows(frame);
    this.arrows.set(arrows);
    this.arrowCount = arrows.length / 4;
    this.arrowFinal = frame.nextWaveFinal;
    const shots = turretTracers(frame);
    this.shots.set(shots);
    this.shotCount = shots.length / 4;
    const upload = performance.now() - start;

    const s = this.stats;
    const n = ++s.frames;
    s.latencyMs += (latency - s.latencyMs) / n;
    s.encodeMs += (frame.encodeMs - s.encodeMs) / n;
    s.uploadMs += (upload - s.uploadMs) / n;
    s.maxLatencyMs = Math.max(s.maxLatencyMs, latency);
    s.maxUploadMs = Math.max(s.maxUploadMs, upload);
    s.alive = frame.alive;
    s.elites = frame.elites;
    s.wave = frame.wave;
    s.hqHp = frame.hqHp;
    s.hqMaxHp = frame.hqMaxHp;
  }

  draw(cam: Float32Array, timeSec: number): void {
    if (this.tex === null || this.stats.hidden) return;
    const gl = this.gl;
    const timing = this.beginGpuTimer();
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uHorde, 0);
    gl.uniform2i(this.uGridSize, this.gridW, this.gridH);
    gl.uniform1f(this.uTime, timeSec);
    gl.uniform4fv(this.uArrows, this.arrows);
    gl.uniform1i(this.uArrowCount, this.arrowCount);
    gl.uniform1i(this.uArrowFinal, this.arrowFinal ? 1 : 0);
    gl.uniform4fv(this.uShots, this.shots);
    gl.uniform1i(this.uShotCount, this.shotCount);
    gl.uniformMatrix3fv(this.uCamera, false, cam);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    if (timing && this.timerExt) gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
  }

  /** Starts a GPU timer unless one is still in flight; collects the last. */
  private beginGpuTimer(): boolean {
    const gl = this.gl;
    const ext = this.timerExt;
    if (ext === null) return false;
    if (this.query !== null) {
      if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
        return false;
      }
      const ns = gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number;
      const s = this.stats;
      const n = ++s.gpuSamples;
      s.gpuMs += (ns / 1e6 - s.gpuMs) / n;
    } else {
      this.query = gl.createQuery();
    }
    gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query!);
    return true;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.query) gl.deleteQuery(this.query);
    gl.deleteVertexArray(this.vao);
  }
}
