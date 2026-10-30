/**
 * What the terrain means to the horde (zfront), from a terrain byte: shared
 * by the simulation (the horde's cost field, wall anchors) and the client,
 * which colours the map by the same rule so it shows what the horde does.
 *
 * Terrain byte layout: bit 7 land, bit 6 shoreline, bit 5 ocean (water
 * only), bits 0-4 magnitude. Impassable terrain is land with magnitude 31.
 */

/** Terrain magnitude at which Shamblers can no longer climb. */
export const HORDE_BLOCKED_MAGNITUDE = 20;

/** Coarse cells from a new wall post that its spans can reach. */
export const WALL_SNAP_RADIUS = 8;

const LAND_BIT = 0x80;
const MAGNITUDE_MASK = 0x1f;
const IMPASSABLE_MAGNITUDE = 31;

/**
 * Horde movement cost of a tile: 0 (blocked) for water, impassable and
 * mountain at or above `blockedMagnitude`, otherwise 1 + magnitude / 4, so
 * higher ground is slower and hordes prefer valleys.
 */
export function hordeMoveCost(
  terrainByte: number,
  blockedMagnitude: number = HORDE_BLOCKED_MAGNITUDE,
): number {
  if ((terrainByte & LAND_BIT) === 0) return 0;
  const mag = terrainByte & MAGNITUDE_MASK;
  if (mag >= blockedMagnitude || mag === IMPASSABLE_MAGNITUDE) return 0;
  return 1 + (mag >> 2);
}

/**
 * Whether a tile blocks the horde and holds a wall: land the horde can't
 * cross (mountains, cliffs, buildings, impassable terrain). Water blocks the
 * horde too but is no anchor.
 */
export function isWallAnchorTerrain(
  terrainByte: number,
  blockedMagnitude: number = HORDE_BLOCKED_MAGNITUDE,
): boolean {
  return (
    (terrainByte & LAND_BIT) !== 0 &&
    hordeMoveCost(terrainByte, blockedMagnitude) === 0
  );
}
