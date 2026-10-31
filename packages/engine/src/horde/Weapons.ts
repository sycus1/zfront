import { Unit } from "../game/Game";
import { Elites } from "./Elites";
import { HordeField } from "./HordeField";

/**
 * zfront: rules shared by the horde-mode weapons (turrets and mortars).
 *
 * Targeting: every weapon goes for the zombies in its reach that are
 * nearest the HQ it defends (the HQ nearest the weapon), straight-line on
 * the coarse grid, so the ones about to reach the HQ die first. With no
 * HQ to defend (hq -1) a turret falls back to the zombies nearest itself.
 * Mortars (Mortars.ts) apply it to crowds worth a shell.
 */

/**
 * Whether a weapon can fire this tick: still standing and finished building.
 * A weapon under construction neither kills nor shows a shot.
 */
export function readyToFire(u: Unit): boolean {
  return u.isActive() && !u.isUnderConstruction();
}

/**
 * (dx, cell offset) pairs for every cell within `r`, nearest first and then
 * in row-major order, so turrets always pick targets the same way, with
 * each cell's distance squared.
 */
export function discOffsets(
  r: number,
  w: number,
): { offsets: Int32Array; d2: Int32Array } {
  const pts: [number, number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r) pts.push([d2, dy, dx]);
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const offsets = new Int32Array(pts.length * 2);
  const d2 = new Int32Array(pts.length);
  pts.forEach(([dist2, dy, dx], k) => {
    offsets[2 * k] = dx;
    offsets[2 * k + 1] = dy * w + dx;
    d2[k] = dist2;
  });
  return { offsets, d2 };
}

/** Squared straight-line distance between two coarse cells. */
export function cellD2(a: number, b: number, w: number): number {
  const ax = a % w;
  const bx = b % w;
  const dx = ax - bx;
  const dy = (a - ax) / w - (b - bx) / w;
  return dx * dx + dy * dy;
}

/** Of `hqs`, the cell nearest `c` (the first on a tie), or -1 if none. */
export function nearestCell(
  c: number,
  hqs: readonly number[],
  w: number,
): number {
  let best = -1;
  let bestD2 = Infinity;
  for (const hq of hqs) {
    const d2 = cellD2(c, hq, w);
    if (d2 < bestD2) {
      best = hq;
      bestD2 = d2;
    }
  }
  return best;
}

/** Reused by every volley (each starts by clearing it), to save garbage. */
const VOLLEY_SCRATCH: number[] = [];

/** What one turret's volley of shamblers did. */
export interface Volley {
  shamblers: number;
  /** The first cell it shot at (the priority target), or -1. */
  target: number;
}

/**
 * Kills up to `budget` shamblers in the cells of `offsets` (dx, cell
 * offset pairs, nearest the turret first, with squared distances `d2`)
 * that lie within `r2` of turret cell `c`: those nearest `hq` first, then
 * nearest the turret.
 */
export function turretVolley(
  field: HordeField,
  c: number,
  w: number,
  h: number,
  offsets: Int32Array,
  d2: Int32Array,
  r2: number,
  hq: number,
  budget: number,
): Volley {
  const scratch = VOLLEY_SCRATCH;
  const n = w * h;
  const cx = c % w;
  const density = field.density;
  // Occupied cells in reach, keyed by distance to the HQ then scan order.
  const pairs = offsets.length >> 1;
  scratch.length = 0;
  for (let k = 0; k < pairs; k++) {
    if (d2[k] > r2) break;
    const x = cx + offsets[2 * k];
    const cell = c + offsets[2 * k + 1];
    if (x < 0 || x >= w || cell < 0 || cell >= n) continue;
    if (density[cell] === 0) continue;
    const near = hq < 0 ? 0 : cellD2(cell, hq, w);
    scratch.push(near * pairs + k);
  }
  if (hq >= 0) scratch.sort((a, b) => a - b);
  let shamblers = 0;
  let target = -1;
  for (let i = 0; i < scratch.length && budget > 0; i++) {
    const cell = c + offsets[2 * (scratch[i] % pairs) + 1];
    const removed = field.remove(cell, budget);
    if (target < 0) target = cell;
    budget -= removed;
    shamblers += removed;
  }
  return { shamblers, target };
}

/**
 * The live elite within `r2` of `c` nearest `hq` (the first listed on a
 * tie, and the first in range when hq is -1), or -1 if none.
 */
export function priorityElite(
  elites: Elites,
  c: number,
  w: number,
  r2: number,
  hq: number,
): number {
  let best = -1;
  let bestD2 = Infinity;
  for (let e = 0; e < elites.count; e++) {
    if (elites.hp[e] <= 0) continue;
    const ec = elites.cell[e];
    if (cellD2(ec, c, w) > r2) continue;
    if (hq < 0) return e;
    const d2 = cellD2(ec, hq, w);
    if (d2 < bestD2) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}
