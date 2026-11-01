import { sectorOf } from "./WaveDirector";
import { nearestCell } from "./Weapons";

/**
 * zfront: what the HUD's events feed is told about the fight. Pure and
 * stateless: alerts are worked out from the horde as it stands, so nothing
 * here goes into a snapshot.
 */

/** Ticks between checks for elites at the walls (15 s). */
export const ELITE_ALERT_INTERVAL = 150;

/** Most "elite at the wall" messages one check sends a player. */
export const MAX_ELITE_ALERTS = 3;

/** Compass sectors by number (sectorOf), as `horde_direction_long` keys. */
export const SECTOR_KEYS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/**
 * For each HQ cell, a bit mask of the compass sectors (bit 0 north, then
 * clockwise) in which an elite stands next to a wall. A wall is any cell
 * `isWall` says is one; the sector is the wall's, seen from the HQ nearest
 * the elite.
 */
export function elitesAtWalls(
  eliteCells: ArrayLike<number>,
  isWall: (cell: number) => boolean,
  width: number,
  height: number,
  hqs: readonly number[],
): Map<number, number> {
  const out = new Map<number, number>();
  if (hqs.length === 0) return out;
  for (let k = 0; k < eliteCells.length; k++) {
    const c = eliteCells[k];
    const x = c % width;
    const y = (c - x) / width;
    // The first wall beside it, checked N, E, S, W.
    let wall = -1;
    if (y > 0 && isWall(c - width)) wall = c - width;
    else if (x < width - 1 && isWall(c + 1)) wall = c + 1;
    else if (y < height - 1 && isWall(c + width)) wall = c + width;
    else if (x > 0 && isWall(c - 1)) wall = c - 1;
    if (wall < 0) continue;
    const hq = nearestCell(wall, hqs, width);
    const dx = (wall % width) - (hq % width);
    const dy = Math.floor(wall / width) - Math.floor(hq / width);
    if (dx === 0 && dy === 0) continue;
    out.set(hq, (out.get(hq) ?? 0) | (1 << sectorOf(dx, dy)));
  }
  return out;
}

/** The sectors in a mask, clockwise from north, at most `max` of them. */
export function maskSectors(mask: number, max: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < SECTOR_KEYS.length && out.length < max; s++) {
    if ((mask & (1 << s)) !== 0) out.push(s);
  }
  return out;
}
