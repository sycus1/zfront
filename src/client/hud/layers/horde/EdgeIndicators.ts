import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import {
  HORDE_DENSITY_MAX_BYTE,
  hordeDensityCount,
} from "@openfront/engine-lib/game/HordeCells";

/**
 * zfront: where the edge-of-screen indicators go. Everything here is pure
 * (no DOM) so it can be tested: `hordeClusters` and `crateTargets` read a
 * horde frame once per tick, and `edgeMarkers` places the markers for the
 * current camera every animation frame.
 */

/** Coarse cells per side of a cluster block (8 cells = 16 tiles). */
export const CLUSTER_BLOCK = 8;
/** Directions off-screen zombies are grouped into. */
export const HORDE_SECTORS = 16;
/** The elite marker byte in `HordeFrame.cells`. */
const ELITE_BYTE = 255;
/** Ints per crate in `HordeFrame.crates`. */
const CRATE_STRIDE = 5;

/**
 * The horde summed over blocks of `block`×`block` coarse cells: three
 * floats per non-empty block, its zombie-weighted centre in tiles (x, y)
 * and how many zombies it holds. Elites count as one each.
 */
export function hordeClusters(
  frame: Pick<HordeFrame, "width" | "height" | "cells">,
  block = CLUSTER_BLOCK,
): Float32Array {
  const { width: w, height: h, cells } = frame;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const count = new Float64Array(bw * bh);
  const sx = new Float64Array(bw * bh);
  const sy = new Float64Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const by = Math.floor(y / block) * bw;
    for (let x = 0; x < w; x++) {
      const b = cells[row + x];
      if (b === 0) continue;
      let n: number;
      if (b <= HORDE_DENSITY_MAX_BYTE) n = hordeDensityCount(b);
      else if (b === ELITE_BYTE) n = 1;
      else continue; // a building or a wall
      const k = by + Math.floor(x / block);
      count[k] += n;
      // A coarse cell is 2×2 tiles; its centre is at 2x + 1.
      sx[k] += (2 * x + 1) * n;
      sy[k] += (2 * y + 1) * n;
    }
  }
  let filled = 0;
  for (let k = 0; k < count.length; k++) if (count[k] > 0) filled++;
  const out = new Float32Array(filled * 3);
  let i = 0;
  for (let k = 0; k < count.length; k++) {
    const n = count[k];
    if (n <= 0) continue;
    out[i++] = sx[k] / n;
    out[i++] = sy[k] / n;
    out[i++] = n;
  }
  return out;
}

export interface CrateTarget {
  id: number;
  /** The crate's tile. */
  x: number;
  y: number;
  gold: number;
}

/** The frame's supply crates. `mapWidth` is in tiles. */
export function crateTargets(
  frame: Pick<HordeFrame, "crates">,
  mapWidth: number,
): CrateTarget[] {
  const c = frame.crates;
  const out: CrateTarget[] = [];
  for (let k = 0; k + CRATE_STRIDE <= c.length; k += CRATE_STRIDE) {
    const tile = c[k + 1];
    out.push({
      id: c[k],
      x: tile % mapWidth,
      y: Math.floor(tile / mapWidth),
      gold: c[k + 2],
    });
  }
  return out;
}

/**
 * Tiles where the announced wave lands, while it is counting down (not
 * while the wave under way still has to be cleared), else empty.
 */
export function incomingTargets(
  frame: Pick<
    HordeFrame,
    | "width"
    | "outcome"
    | "nextWave"
    | "nextWaveIn"
    | "clearing"
    | "nextWaveLandings"
  >,
): Float32Array {
  if (
    frame.outcome === "lost" ||
    frame.nextWave === 0 ||
    frame.clearing ||
    frame.nextWaveIn < 0
  ) {
    return new Float32Array(0);
  }
  const w = frame.width;
  const out = new Float32Array(frame.nextWaveLandings.length * 2);
  let i = 0;
  for (const cell of frame.nextWaveLandings) {
    out[i++] = 2 * (cell % w) + 1;
    out[i++] = 2 * Math.floor(cell / w) + 1;
  }
  return out;
}

/**
 * The camera as the markers need it: screen = origin + tile × scale, in CSS
 * pixels, over a viewport `width`×`height` starting at (0, 0).
 */
export interface EdgeCamera {
  scale: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** How far in from each screen edge the markers sit, in CSS pixels. */
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type EdgeMarkerKind = "horde" | "incoming" | "crate";

export interface EdgeMarker {
  kind: EdgeMarkerKind;
  /** Stable within a kind across frames (sector, or crate id). */
  key: number;
  /** Where the marker sits on screen, in CSS pixels. */
  x: number;
  y: number;
  /** Direction from the screen centre to the target, in radians. */
  angle: number;
  /** The target in tiles, for panning the camera to it. */
  tileX: number;
  tileY: number;
  /** Zombies (horde), landings (incoming) or gold (crate). */
  amount: number;
  /** How strongly it glows, 0 to 1. */
  strength: number;
  /** Tiles from the edge of the view to the target. */
  distance: number;
}

/** Zombies at which a horde marker glows at full strength. */
export const FULL_GLOW_ZOMBIES = 400;

/**
 * The point where the ray from (cx, cy) towards (tx, ty) leaves the rect
 * [left, right]×[top, bottom]; (cx, cy) must lie inside it.
 */
export function clampToRect(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (right - cx) / dx);
  else if (dx < 0) t = Math.min(t, (left - cx) / dx);
  if (dy > 0) t = Math.min(t, (bottom - cy) / dy);
  else if (dy < 0) t = Math.min(t, (top - cy) / dy);
  if (!Number.isFinite(t) || t >= 1) return { x: tx, y: ty };
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Tiles from the visible part of the map to (sx, sy) on screen. */
function offscreenTiles(cam: EdgeCamera, sx: number, sy: number): number {
  const ox = sx < 0 ? -sx : sx > cam.width ? sx - cam.width : 0;
  const oy = sy < 0 ? -sy : sy > cam.height ? sy - cam.height : 0;
  return Math.hypot(ox, oy) / cam.scale;
}

/** Markers closer than this on screen are merged into one, in CSS pixels. */
export const MERGE_PX = 64;

/** The sector an angle falls in; the compass points are sector centres. */
function sectorOf(angle: number, sectors: number): number {
  const turn = (angle + Math.PI) / (2 * Math.PI) + 0.5 / sectors;
  return Math.floor(turn * sectors) % sectors;
}

interface Bucket {
  amount: number;
  sx: number;
  sy: number;
  near: number;
}

/**
 * Groups points (x, y in tiles, weight) that are off-screen by direction
 * from the screen centre and places one marker per group on the inset edge.
 */
function sectorMarkers(
  kind: EdgeMarkerKind,
  points: Float32Array,
  stride: number,
  cam: EdgeCamera,
  insets: EdgeInsets,
  strength: (amount: number) => number,
): EdgeMarker[] {
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const buckets: (Bucket | undefined)[] = new Array(HORDE_SECTORS);
  for (let k = 0; k + stride <= points.length; k += stride) {
    const weight = stride > 2 ? points[k + 2] : 1;
    const sx = cam.originX + points[k] * cam.scale;
    const sy = cam.originY + points[k + 1] * cam.scale;
    if (sx >= 0 && sx <= cam.width && sy >= 0 && sy <= cam.height) continue;
    const s = sectorOf(Math.atan2(sy - cy, sx - cx), HORDE_SECTORS);
    const b = (buckets[s] ??= { amount: 0, sx: 0, sy: 0, near: Infinity });
    b.amount += weight;
    b.sx += sx * weight;
    b.sy += sy * weight;
    b.near = Math.min(b.near, offscreenTiles(cam, sx, sy));
  }
  // Neighbouring sectors whose markers would overlap become one marker.
  const groups: { key: number; b: Bucket }[] = [];
  const place = (b: Bucket) =>
    clampToRect(
      cx,
      cy,
      b.sx / b.amount,
      b.sy / b.amount,
      insets.left,
      insets.top,
      cam.width - insets.right,
      cam.height - insets.bottom,
    );
  for (let s = 0; s < HORDE_SECTORS; s++) {
    const b = buckets[s];
    if (b !== undefined) groups.push({ key: s, b });
  }
  for (let merged = true; merged && groups.length > 1;) {
    merged = false;
    for (let i = 0; i < groups.length && groups.length > 1; i++) {
      const j = (i + 1) % groups.length;
      const a = groups[i].b;
      const b = groups[j].b;
      const pa = place(a);
      const pb = place(b);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) >= MERGE_PX) continue;
      const big = a.amount >= b.amount ? groups[i] : groups[j];
      groups[i] = {
        key: big.key,
        b: {
          amount: a.amount + b.amount,
          sx: a.sx + b.sx,
          sy: a.sy + b.sy,
          near: Math.min(a.near, b.near),
        },
      };
      groups.splice(j, 1);
      merged = true;
    }
  }
  const out: EdgeMarker[] = [];
  for (const { key, b } of groups) {
    const tx = b.sx / b.amount;
    const ty = b.sy / b.amount;
    const p = place(b);
    out.push({
      kind,
      key,
      x: p.x,
      y: p.y,
      angle: Math.atan2(ty - cy, tx - cx),
      tileX: (tx - cam.originX) / cam.scale,
      tileY: (ty - cam.originY) / cam.scale,
      amount: b.amount,
      strength: strength(b.amount),
      distance: b.near,
    });
  }
  return out;
}

/** A horde marker's glow: grows with the square root of its zombies. */
export function hordeStrength(zombies: number): number {
  return Math.min(1, 0.4 + 0.6 * Math.sqrt(zombies / FULL_GLOW_ZOMBIES));
}

/**
 * The markers for everything off-screen: one horde marker per direction
 * the zombies are in, one incoming marker per direction the announced wave
 * lands from, and one marker per supply crate.
 */
export function edgeMarkers(
  clusters: Float32Array,
  incoming: Float32Array,
  crates: readonly CrateTarget[],
  cam: EdgeCamera,
  insets: EdgeInsets,
): EdgeMarker[] {
  if (cam.width <= 0 || cam.height <= 0 || cam.scale <= 0) return [];
  const out = sectorMarkers("horde", clusters, 3, cam, insets, hordeStrength);
  out.push(...sectorMarkers("incoming", incoming, 2, cam, insets, () => 1));
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  for (const c of crates) {
    // The crate's tile centre.
    const sx = cam.originX + (c.x + 0.5) * cam.scale;
    const sy = cam.originY + (c.y + 0.5) * cam.scale;
    if (sx >= 0 && sx <= cam.width && sy >= 0 && sy <= cam.height) continue;
    const p = clampToRect(
      cx,
      cy,
      sx,
      sy,
      insets.left,
      insets.top,
      cam.width - insets.right,
      cam.height - insets.bottom,
    );
    out.push({
      kind: "crate",
      key: c.id,
      x: p.x,
      y: p.y,
      angle: Math.atan2(sy - cy, sx - cx),
      tileX: c.x,
      tileY: c.y,
      amount: c.gold,
      strength: 1,
      distance: offscreenTiles(cam, sx, sy),
    });
  }
  return out;
}
