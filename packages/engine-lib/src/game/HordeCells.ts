/**
 * The density bytes of `HordeFrame.cells` (zfront). Up to
 * `HORDE_EXACT_MAX` zombies a cell's byte is its exact count, so the
 * renderer can draw one square per zombie where the horde is thin. Above
 * that each byte step covers `HORDE_DENSITY_STEP` zombies, up to
 * `HORDE_DENSITY_MAX_BYTE`; the bytes above it mark buildings and elites.
 */

export const HORDE_EXACT_MAX = 64;
export const HORDE_DENSITY_STEP = 11;
export const HORDE_DENSITY_MAX_BYTE = 247;

/** The byte for a cell holding `count` zombies (0 for none). */
export function hordeDensityByte(count: number): number {
  if (count <= HORDE_EXACT_MAX) return count;
  const b =
    HORDE_EXACT_MAX + Math.ceil((count - HORDE_EXACT_MAX) / HORDE_DENSITY_STEP);
  return Math.min(HORDE_DENSITY_MAX_BYTE, b);
}

/**
 * The zombies a density byte stands for: exact up to `HORDE_EXACT_MAX`,
 * otherwise the top of its step.
 */
export function hordeDensityCount(byte: number): number {
  if (byte <= HORDE_EXACT_MAX) return byte;
  return HORDE_EXACT_MAX + (byte - HORDE_EXACT_MAX) * HORDE_DENSITY_STEP;
}
