import { Elites } from "./Elites";
import { HordeField } from "./HordeField";

/**
 * zfront: the horde-mode buildings that aren't walls or turrets.
 *
 * - A mine waits until enough of the horde is around it, then blows up the
 *   zombies within its radius and is gone.
 * - A noise beacon sounds for a while, then rests, over and over. While it
 *   sounds it is a horde target with a head start in the flow field, so the
 *   horde heads for it ahead of anything up to `baitPull` cells nearer. Put
 *   it where your turrets can reach: a kill box.
 * - A scavenger depot brings its owner's supply drops sooner (Crates.ts),
 *   and pays `depotIncome` every tick (Economy.payHqIncome; 0 by default).
 *
 * Integers only.
 */

export interface BuildingOptions {
  /** Radius in coarse cells that a mine watches and blows up. */
  mineRadius: number;
  /** Zombies (an elite counts as one) within the radius that set it off. */
  mineTrigger: number;
  /** Most shamblers one mine kills, nearest first. */
  mineKills: number;
  /** Damage to each elite within the radius. */
  mineEliteDamage: number;
  /** A sounding beacon draws the horde from this many cells further away. */
  baitPull: number;
  /** Ticks a beacon sounds for, then ticks it rests, from when it is built. */
  baitActive: number;
  baitCooldown: number;
}

/** Whether a beacon built at tick `since` is sounding at tick `ticks`. */
export function beaconSounding(
  opts: BuildingOptions,
  since: number,
  ticks: number,
): boolean {
  const cycle = opts.baitActive + opts.baitCooldown;
  if (cycle <= 0) return false;
  return (ticks - since) % cycle < opts.baitActive;
}

/**
 * Sets off the mine on coarse cell `c` if enough of the horde is within
 * `offsets` (a disc from discOffsets, nearest first) of it. Returns the
 * shamblers killed and the elites it finished, or null if it didn't go off.
 */
export function detonate(
  opts: BuildingOptions,
  field: HordeField,
  elites: Elites,
  c: number,
  offsets: Int32Array,
): { shamblers: number; elites: number } | null {
  const width = field.width;
  const n = width * field.height;
  const cx = c % width;
  const cy = (c - cx) / width;
  const r2 = opts.mineRadius * opts.mineRadius;
  let near = 0;
  for (let k = 0; k < offsets.length; k += 2) {
    const x = cx + offsets[k];
    const cell = c + offsets[k + 1];
    if (x < 0 || x >= width || cell < 0 || cell >= n) continue;
    near += field.density[cell];
  }
  const inRange: number[] = [];
  for (let e = 0; e < elites.count; e++) {
    const ec = elites.cell[e];
    const dx = (ec % width) - cx;
    const dy = Math.floor(ec / width) - cy;
    if (dx * dx + dy * dy <= r2 && elites.hp[e] > 0) inRange.push(e);
  }
  if (near + inRange.length < opts.mineTrigger) return null;
  let budget = opts.mineKills;
  let shamblers = 0;
  for (let k = 0; k < offsets.length && budget > 0; k += 2) {
    const x = cx + offsets[k];
    const cell = c + offsets[k + 1];
    if (x < 0 || x >= width || cell < 0 || cell >= n) continue;
    const removed = field.remove(cell, budget);
    budget -= removed;
    shamblers += removed;
  }
  let finished = 0;
  for (const e of inRange) {
    elites.hp[e] -= opts.mineEliteDamage;
    if (elites.hp[e] <= 0) finished++;
  }
  return { shamblers, elites: finished };
}
