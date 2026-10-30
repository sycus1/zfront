import { GameMapType, maps } from "@openfront/engine-api/game/Maps.gen";

/**
 * zfront: real-world metres per tile on close-up town maps (from the map's
 * info.json), or 0 on continent-scale maps.
 */
export function metresPerTile(map: GameMapType): number {
  return maps.find((m) => m.type === map)?.metresPerTile ?? 0;
}

/**
 * zfront: true on close-up town maps, where a tile is a few metres and the
 * horde plays at neighbourhood scale (see horde/TownScale.ts).
 */
export function isTownScale(map: GameMapType): boolean {
  const m = metresPerTile(map);
  return m > 0 && m <= 10;
}
