/**
 * HordePass — zfront's zombie horde, drawn over territory.
 *
 * The worker sends the horde as one byte per coarse (map4x) cell. The pass
 * uploads it as an R8 texture each time a new frame arrives and draws it on
 * a map-sized quad: elites as pulsing markers, an arrow at each place the
 * announced wave comes ashore, pointing at the HQ, tracers from each turret
 * that is shooting to what it hit, mortar shells arcing to where they land
 * and the blasts when they do, and supply crates with a ring showing the
 * time they have left or how far looting has got. Zombies are squares, one
 * each (`HordeSwarm`), walking between cells as the counts change; cells too
 * packed for a square each also get a dark blob under the squares. It also
 * finds each blob's zombie count (`hordeBlobs`) for the renderer to write
 * inside the blob. While a horde building is being placed it also draws the
 * build grid round the cursor and the wall spans the new post would link up
 * with.
 *
 * Spike instrumentation: transfer latency, worker encode time and upload
 * time are accumulated on `globalThis.__zfrontHorde` for measurement.
 */

import { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import {
  HORDE_DENSITY_STEP,
  HORDE_EXACT_MAX,
  hordeDensityCount,
} from "@openfront/engine-lib/game/HordeCells";
import { assetUrl } from "@openfront/shared/AssetUrls";
import {
  HordeSwarm,
  SWARM_DEATH_SEC,
  SWARM_FLOATS,
} from "../../horde/HordeSwarm";
import type { GhostPreviewData } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import hordeFragSrc from "../shaders/horde/horde.frag.glsl?raw";
import hordeVertSrc from "../shaders/horde/horde.vert.glsl?raw";
import swarmFragSrc from "../shaders/horde/swarm.frag.glsl?raw";
import swarmVertSrc from "../shaders/horde/swarm.vert.glsl?raw";
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

/** Wall links previewed at most (a new post makes up to two). */
export const MAX_LINKS = 2;

/**
 * The build grid's centre (the ghost's coarse cell, at its middle) and the
 * previewed links as coarse-cell centres x0, y0, x1, y1, or null when no
 * horde building is being placed.
 */
export function buildOverlay(
  ghost: GhostPreviewData | null,
): { cursor: [number, number]; links: Float32Array } | null {
  if (ghost === null || !ghost.buildGrid) return null;
  // Tile coordinates follow the shader's convention (+0.5 is the centre).
  const cell = (t: number) => Math.floor((t + 0.5) / 2) + 0.5;
  const links = new Float32Array(MAX_LINKS * 4);
  const runs = ghost.wallLinks ?? [];
  let n = 0;
  for (let k = 0; k + 3 < runs.length && n < MAX_LINKS; k += 4, n++) {
    links.set(runs.slice(k, k + 4).map(cell), n * 4);
  }
  return {
    cursor: [cell(ghost.tileX), cell(ghost.tileY)],
    links: links.subarray(0, n * 4),
  };
}

/**
 * Arrows for the announced wave: per arrow, its landing cell's centre and
 * the unit direction to the HQ, in coarse cells. Empty once no wave is
 * announced or there is no HQ to point at.
 */
export function waveArrows(frame: HordeFrame): Float32Array {
  const out = new Float32Array(MAX_ARROWS * 4);
  if (frame.outcome === "lost" || frame.nextWave === 0 || frame.hqCell < 0) {
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

/** Mortar shells and blasts drawn at most; the rest fly unseen. */
export const MAX_SHELLS = 32;
export const MAX_BLASTS = 16;
/** How long a blast stays on screen, and one engine tick, in seconds. */
export const BLAST_SECONDS = 0.6;
const TICK_SECONDS = 0.1;
/** Ints per shell in HordeFrame.mortarShells. */
const SHELL_STRIDE = 4;

/**
 * Where the frame's mortar shells are `elapsed` seconds after it arrived:
 * per shell, the shell (lifted on its arc) and its shadow on the ground
 * below, in coarse cells. The arc's peak grows with the shot's length.
 */
export function mortarShells(
  frame: Pick<HordeFrame, "width" | "mortarShells">,
  elapsed: number,
): Float32Array {
  const s = frame.mortarShells;
  const n = Math.min(MAX_SHELLS, Math.floor(s.length / SHELL_STRIDE));
  const out = new Float32Array(n * 4);
  const w = frame.width;
  for (let k = 0; k < n; k++) {
    const from = s[k * SHELL_STRIDE];
    const to = s[k * SHELL_STRIDE + 1];
    const left = s[k * SHELL_STRIDE + 2] - elapsed / TICK_SECONDS;
    const flight = Math.max(1, s[k * SHELL_STRIDE + 3]);
    const t = Math.min(1, Math.max(0, 1 - left / flight));
    const ax = (from % w) + 0.5;
    const ay = Math.floor(from / w) + 0.5;
    const bx = (to % w) + 0.5;
    const by = Math.floor(to / w) + 0.5;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const peak = Math.max(2, Math.hypot(bx - ax, by - ay) * 0.35);
    out.set([x, y - 4 * peak * t * (1 - t), x, y], k * 4);
  }
  return out;
}

/** Crates drawn at most; the default drops at most 3 per player. */
export const MAX_CRATES = 16;
/** Ints per crate in HordeFrame.crates. */
const CRATE_STRIDE = 5;

export interface CrateMarker {
  id: number;
  /** The crate's tile. */
  x: number;
  y: number;
  gold: number;
  /** Share of looting done, 0 to 1, or -1 when nobody is looting it. */
  looted: number;
  /** Share of its life left, 0 to 1. */
  life: number;
}

/** The frame's crates, at most MAX_CRATES. `mapWidth` is in tiles. */
export function crateMarkers(
  frame: HordeFrame,
  mapWidth: number,
): CrateMarker[] {
  const c = frame.crates;
  const out: CrateMarker[] = [];
  for (let k = 0; k + CRATE_STRIDE <= c.length; k += CRATE_STRIDE) {
    if (out.length >= MAX_CRATES) break;
    const tile = c[k + 1];
    const lootLeft = c[k + 4];
    const lootTicks = Math.max(1, frame.crateLootTicks);
    out.push({
      id: c[k],
      x: tile % mapWidth,
      y: Math.floor(tile / mapWidth),
      gold: c[k + 2],
      looted: lootLeft < 0 ? -1 : 1 - Math.min(lootTicks, lootLeft) / lootTicks,
      life: Math.min(1, c[k + 3] / Math.max(1, frame.crateLife)),
    });
  }
  return out;
}

/** Tiles from a crate that a click still picks it. */
export const CRATE_CLICK_RADIUS = 4;

/** The id of the crate nearest tile (x, y) within reach of a click, or -1. */
export function crateAt(
  frame: HordeFrame,
  mapWidth: number,
  x: number,
  y: number,
): number {
  let best = -1;
  let bestD2 = CRATE_CLICK_RADIUS * CRATE_CLICK_RADIUS;
  for (const m of crateMarkers(frame, mapWidth)) {
    const d2 = (m.x - x) ** 2 + (m.y - y) ** 2;
    if (d2 <= bestD2) {
      best = m.id;
      bestD2 = d2;
    }
  }
  return best;
}

/** Blobs labelled at most, largest first, so a scattered horde stays legible. */
export const MAX_BLOB_LABELS = 64;

export interface HordeBlob {
  /** The blob's density-weighted centre, in tiles. */
  x: number;
  y: number;
  /** Zombies in it, elites included. */
  count: number;
}

/**
 * The horde's blobs: groups of touching (8-neighbour) density and elite
 * cells, largest first. The frame only carries exact counts for thin
 * cells, so each blob gets its share of `frame.alive` by the counts the
 * cells stand for, plus its elites. Blobs that round to no zombies are left out.
 */
export function hordeBlobs(frame: HordeFrame): HordeBlob[] {
  const { width: w, height: h, cells } = frame;
  const seen = new Uint8Array(cells.length);
  const stack: number[] = [];
  const raw: { sx: number; sy: number; weight: number; elites: number }[] = [];
  let total = 0;
  for (let start = 0; start < cells.length; start++) {
    if (seen[start] || !isHorde(cells[start])) continue;
    seen[start] = 1;
    stack.push(start);
    let sx = 0;
    let sy = 0;
    let weight = 0;
    let elites = 0;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const x = c % w;
      const y = (c - x) / w;
      // An elite cell has no density of its own; weigh it as one zombie so
      // the centre still leans towards it.
      const v = cells[c] === ELITE_BYTE ? 1 : hordeDensityCount(cells[c]);
      if (cells[c] === ELITE_BYTE) elites++;
      else weight += v;
      sx += (x + 0.5) * v;
      sy += (y + 0.5) * v;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (seen[n] || !isHorde(cells[n])) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    total += weight;
    raw.push({ sx, sy, weight, elites });
  }
  const blobs: HordeBlob[] = [];
  for (const b of raw) {
    const shamblers = total > 0 ? (frame.alive * b.weight) / total : 0;
    const count = Math.round(shamblers) + b.elites;
    if (count <= 0) continue;
    const mass = b.weight + b.elites;
    // Coarse cells are 2x2 tiles; the text shader adds half a tile.
    blobs.push({
      x: (b.sx / mass) * 2 - 0.5,
      y: (b.sy / mass) * 2 - 0.5,
      count,
    });
  }
  blobs.sort((a, b) => b.count - a.count);
  return blobs.slice(0, MAX_BLOB_LABELS);
}

const ELITE_BYTE = 255;
/** Bytes from here up to the elite byte are buildings and walls. */
const FIRST_BUILDING_BYTE = 248;

function isHorde(b: number): boolean {
  return b === ELITE_BYTE || (b > 0 && b < FIRST_BUILDING_BYTE);
}

export class HordePass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture | null = null;
  /**
   * Pixel-art textures for one-cell buildings (cell-sprites.png, drawn by
   * scripts/sprites/buildingSprites.ts); transparent until it loads.
   */
  private cellTex: WebGLTexture;
  private uCells: WebGLUniformLocation;
  private uCellTexSize: WebGLUniformLocation;
  private cellTexSize: [number, number] = [1, 1];
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
  private uLayer: WebGLUniformLocation;
  private uPackedFrom: WebGLUniformLocation;
  private readonly swarm = new HordeSwarm();
  private swarmProgram: WebGLProgram;
  private swarmVao: WebGLVertexArrayObject;
  private swarmCorners: WebGLBuffer;
  private swarmBuf: DynamicInstanceBuffer;
  private swarmCount = 0;
  private uSwarmCamera: WebGLUniformLocation;
  private uSwarmNow: WebGLUniformLocation;
  private uSwarmMoveStart: WebGLUniformLocation;
  private uSwarmMoveSec: WebGLUniformLocation;
  private uSwarmSize: WebGLUniformLocation;
  private uSwarmRim: WebGLUniformLocation;
  private uCrates: WebGLUniformLocation;
  private uCrateCount: WebGLUniformLocation;
  private crates = new Float32Array(MAX_CRATES * 4);
  private crateCount = 0;
  private shots = new Float32Array(MAX_SHOTS * 4);
  private shotCount = 0;
  private uShells: WebGLUniformLocation;
  private uShellCount: WebGLUniformLocation;
  private uBlasts: WebGLUniformLocation;
  private uBlastCount: WebGLUniformLocation;
  private shellFrame: Pick<HordeFrame, "width" | "mortarShells"> | null = null;
  /** When the shells' frame arrived, in performance.now() seconds. */
  private shellFrameAt = 0;
  private shells = new Float32Array(MAX_SHELLS * 4);
  private shellCount = 0;
  /** Blasts on screen: x, y (coarse cells), radius and start time. */
  private blastList: [number, number, number, number][] = [];
  private blasts = new Float32Array(MAX_BLASTS * 4);
  private uCursor: WebGLUniformLocation;
  private uLinks: WebGLUniformLocation;
  private uLinkCount: WebGLUniformLocation;
  private cursor: [number, number] = [-1, -1];
  private links = new Float32Array(MAX_LINKS * 4);
  private linkCount = 0;
  private arrows = new Float32Array(MAX_ARROWS * 4);
  private arrowCount = 0;
  private arrowFinal = false;
  private readonly stats: HordeRenderStats;
  private readonly timerExt: { TIME_ELAPSED_EXT: number } | null;
  private query: WebGLQuery | null = null;

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    mapH: number,
  ) {
    this.program = createProgram(
      gl,
      shaderSrc(hordeVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderSrc(hordeFragSrc, {
        MAX_ARROWS,
        MAX_SHOTS,
        MAX_SHELLS,
        MAX_BLASTS,
        MAX_LINKS,
        EXACT_MAX: HORDE_EXACT_MAX,
        DENSITY_STEP: HORDE_DENSITY_STEP,
        MAX_CRATES,
      }),
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
    this.uShells = gl.getUniformLocation(this.program, "uShells")!;
    this.uShellCount = gl.getUniformLocation(this.program, "uShellCount")!;
    this.uBlasts = gl.getUniformLocation(this.program, "uBlasts")!;
    this.uBlastCount = gl.getUniformLocation(this.program, "uBlastCount")!;
    this.uLayer = gl.getUniformLocation(this.program, "uLayer")!;
    this.uPackedFrom = gl.getUniformLocation(this.program, "uPackedFrom")!;
    this.uCursor = gl.getUniformLocation(this.program, "uCursor")!;
    this.uLinks = gl.getUniformLocation(this.program, "uLinks")!;
    this.uLinkCount = gl.getUniformLocation(this.program, "uLinkCount")!;
    this.uCrates = gl.getUniformLocation(this.program, "uCrates")!;
    this.uCrateCount = gl.getUniformLocation(this.program, "uCrateCount")!;
    this.vao = createMapQuad(gl, mapW, mapH);
    this.uCells = gl.getUniformLocation(this.program, "uCells")!;
    this.uCellTexSize = gl.getUniformLocation(this.program, "uCellTexSize")!;
    this.cellTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    void this.loadCells();

    this.swarmProgram = createProgram(
      gl,
      shaderSrc(swarmVertSrc, { DEATH_SEC: SWARM_DEATH_SEC }),
      swarmFragSrc,
      "HordeSwarm",
    );
    const sp = this.swarmProgram;
    this.uSwarmCamera = gl.getUniformLocation(sp, "uCamera")!;
    this.uSwarmNow = gl.getUniformLocation(sp, "uNow")!;
    this.uSwarmMoveStart = gl.getUniformLocation(sp, "uMoveStart")!;
    this.uSwarmMoveSec = gl.getUniformLocation(sp, "uMoveSec")!;
    this.uSwarmSize = gl.getUniformLocation(sp, "uSize")!;
    this.uSwarmRim = gl.getUniformLocation(sp, "uRim")!;
    this.swarmVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.swarmVao);
    // A unit quad, as two triangles of corners in [0, 1].
    const corners = (this.swarmCorners = gl.createBuffer()!);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const instances = gl.createBuffer()!;
    this.swarmBuf = new DynamicInstanceBuffer(
      gl,
      instances,
      4096,
      SWARM_FLOATS,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    const stride = SWARM_FLOATS * 4;
    // from x, y, to x, y
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    // seed, born at, died at
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    const g = globalThis as { __zfrontHorde?: HordeRenderStats };
    this.stats = g.__zfrontHorde ??= newStats();
    this.timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  /** The debug toggle that skips the horde draw. */
  get hidden(): boolean {
    return this.stats.hidden;
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
    const now = performance.now() / 1000;
    this.shellFrame = frame;
    this.shellFrameAt = now;
    const w = frame.width;
    for (const c of frame.mortarBlasts) {
      this.blastList.push([
        (c % w) + 0.5,
        Math.floor(c / w) + 0.5,
        Math.max(1, frame.mortarBlastRadius) + 0.5,
        now,
      ]);
    }
    this.blastList = this.blastList.slice(-MAX_BLASTS);
    this.updateSwarm(frame);
    const crates = crateMarkers(frame, this.mapW);
    // Coarse cells are 2x2 tiles: a tile's centre is at (x + 0.5) / 2.
    crates.forEach((m, k) => {
      this.crates.set(
        [(m.x + 0.5) / 2, (m.y + 0.5) / 2, m.looted, m.life],
        k * 4,
      );
    });
    this.crateCount = crates.length;
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

  updateGhostPreview(ghost: GhostPreviewData | null): void {
    const overlay = buildOverlay(ghost);
    this.cursor = overlay?.cursor ?? [-1, -1];
    this.links.fill(0);
    this.links.set(overlay?.links ?? []);
    this.linkCount = (overlay?.links.length ?? 0) / 4;
  }

  /**
   * Moves the squares to the frame's counts and uploads them, when the
   * counts have changed.
   */
  private updateSwarm(frame: HordeFrame): void {
    const now = performance.now() / 1000;
    const swarm = this.swarm;
    if (!swarm.update(frame.cells, frame.width, frame.height, now)) return;
    const buf = this.swarmBuf;
    buf.ensureCapacity(Math.max(1, swarm.maxInstances()));
    this.swarmCount = swarm.writeInstances(buf.float32, now);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      buf.float32,
      0,
      this.swarmCount * SWARM_FLOATS,
    );
  }

  /** `zoom` is screen pixels per tile. */
  draw(cam: Float32Array, timeSec: number, zoom: number): void {
    if (this.tex === null || this.stats.hidden) return;
    const gl = this.gl;
    const timing = this.beginGpuTimer();
    this.updateMortarFx();
    this.drawLayer(cam, timeSec, 0);
    this.drawSwarm(cam, timeSec, zoom);
    this.drawLayer(cam, timeSec, 1);
    if (timing && this.timerExt) gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
  }

  /** Moves the shells along their arcs and ages the blasts, for this draw. */
  private updateMortarFx(): void {
    const now = performance.now() / 1000;
    const shells =
      this.shellFrame === null
        ? new Float32Array()
        : mortarShells(this.shellFrame, now - this.shellFrameAt);
    this.shells.fill(0);
    this.shells.set(shells);
    this.shellCount = shells.length / 4;
    this.blastList = this.blastList.filter((b) => now - b[3] < BLAST_SECONDS);
    this.blasts.fill(0);
    this.blastList.forEach(([x, y, r, at], k) => {
      this.blasts.set([x, y, (now - at) / BLAST_SECONDS, r], k * 4);
    });
  }

  private drawSwarm(cam: Float32Array, timeSec: number, zoom: number): void {
    if (this.swarmCount === 0) return;
    const gl = this.gl;
    const swarm = this.swarm;
    // A third of a tile, but never under about a pixel and a half.
    const size = Math.max(0.34, 1.4 / Math.max(zoom, 1e-3));
    gl.useProgram(this.swarmProgram);
    gl.uniformMatrix3fv(this.uSwarmCamera, false, cam);
    gl.uniform1f(this.uSwarmNow, timeSec);
    gl.uniform1f(this.uSwarmMoveStart, swarm.moveStart);
    gl.uniform1f(this.uSwarmMoveSec, swarm.moveSec);
    gl.uniform1f(this.uSwarmSize, size);
    gl.uniform1f(this.uSwarmRim, size * zoom >= 5 ? 0.18 : 0);
    gl.bindVertexArray(this.swarmVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.swarmCount);
    gl.bindVertexArray(null);
  }

  /** Layer 0 is the packed horde under the squares, 1 the rest over them. */
  private drawLayer(cam: Float32Array, timeSec: number, layer: number): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uHorde, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
    gl.uniform1i(this.uCells, 1);
    gl.uniform2f(this.uCellTexSize, this.cellTexSize[0], this.cellTexSize[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2i(this.uGridSize, this.gridW, this.gridH);
    gl.uniform1f(this.uTime, timeSec);
    gl.uniform4fv(this.uArrows, this.arrows);
    gl.uniform1i(this.uArrowCount, this.arrowCount);
    gl.uniform1i(this.uArrowFinal, this.arrowFinal ? 1 : 0);
    gl.uniform4fv(this.uShots, this.shots);
    gl.uniform1i(this.uShotCount, this.shotCount);
    gl.uniform4fv(this.uShells, this.shells);
    gl.uniform1i(this.uShellCount, this.shellCount);
    gl.uniform4fv(this.uBlasts, this.blasts);
    gl.uniform1i(this.uBlastCount, this.blastList.length);
    gl.uniform1i(this.uLayer, layer);
    gl.uniform1f(this.uPackedFrom, this.swarm.cap);
    gl.uniform2f(this.uCursor, this.cursor[0], this.cursor[1]);
    gl.uniform4fv(this.uLinks, this.links);
    gl.uniform1i(this.uLinkCount, this.linkCount);
    gl.uniform4fv(this.uCrates, this.crates);
    gl.uniform1i(this.uCrateCount, this.crateCount);
    gl.uniformMatrix3fv(this.uCamera, false, cam);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
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

  private async loadCells(): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = assetUrl("atlases/cell-sprites.png");
    await img.decode();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.cellTexSize = [img.width, img.height];
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.tex) gl.deleteTexture(this.tex);
    gl.deleteTexture(this.cellTex);
    if (this.query) gl.deleteQuery(this.query);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.swarmProgram);
    gl.deleteVertexArray(this.swarmVao);
    gl.deleteBuffer(this.swarmCorners);
    this.swarmBuf.dispose();
  }
}
