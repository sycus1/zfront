import { GameMapType } from "@openfront/engine-api/game/Maps.gen";

/**
 * What the map picker says about each map: its kind and size, and how its
 * ground splits between open, solid and water. The percentages are measured
 * from each map's map.bin (tests/client/MapFacts.test.ts holds them to it):
 * open is plains and highland, solid is mountain-height ground (buildings
 * and cliffs the horde walks round), water is water.
 */
export interface MapFacts {
  map: GameMapType;
  /** Preview in the terrain palette, under resources/images/maps/. */
  preview: string;
  /** object-position for the preview crop. */
  previewPosition: string;
  kind: "town" | "city" | "region";
  /** Real width in kilometres, for close-up town maps. */
  km?: number;
  tilesWide: number;
  tilesHigh: number;
  /** Metres per tile, for close-up town maps. */
  metresPerTile?: number;
  open: number;
  solid: number;
  water: number;
}

export const MAP_FACTS: readonly MapFacts[] = [
  {
    map: GameMapType.Bath,
    preview: "images/maps/bath.png",
    previewPosition: "50% 50%",
    kind: "town",
    km: 1.2,
    tilesWide: 400,
    tilesHigh: 400,
    metresPerTile: 3,
    open: 67,
    solid: 29,
    water: 4,
  },
  {
    map: GameMapType.Sheffield,
    preview: "images/maps/sheffield.png",
    previewPosition: "50% 50%",
    kind: "city",
    km: 1.2,
    tilesWide: 400,
    tilesHigh: 400,
    metresPerTile: 3,
    open: 57,
    solid: 43,
    water: 0,
  },
  {
    map: GameMapType.Whitby,
    preview: "images/maps/whitby.png",
    previewPosition: "50% 50%",
    kind: "town",
    km: 1.2,
    tilesWide: 400,
    tilesHigh: 400,
    metresPerTile: 3,
    open: 83,
    solid: 9,
    water: 8,
  },
  {
    map: GameMapType.Cannock,
    preview: "images/maps/cannock.png",
    previewPosition: "50% 50%",
    kind: "town",
    km: 1.2,
    tilesWide: 400,
    tilesHigh: 400,
    metresPerTile: 3,
    open: 81,
    solid: 19,
    water: 0,
  },
  {
    map: GameMapType.Hednesford,
    preview: "images/maps/hednesford.png",
    previewPosition: "50% 50%",
    kind: "town",
    km: 1.2,
    tilesWide: 400,
    tilesHigh: 400,
    metresPerTile: 3,
    open: 87,
    solid: 13,
    water: 0,
  },
  {
    map: GameMapType.Britannia,
    preview: "images/maps/britannia.png",
    previewPosition: "50% 62%",
    kind: "region",
    tilesWide: 1600,
    tilesHigh: 2088,
    open: 32,
    solid: 3,
    water: 65,
  },
];

export function mapFacts(map: GameMapType): MapFacts {
  return MAP_FACTS.find((f) => f.map === map) ?? MAP_FACTS[0];
}
