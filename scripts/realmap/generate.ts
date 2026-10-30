// Turns a real place into a zfront map: the features fetch_overture.py saved
// for a town, plus AWS Terrain Tiles for height, become the map generator's
// inputs (image.png, the roads layer and info.json) in
// map-generator/assets/maps/<town>/. Run the Go generator afterwards.
//
//   npx tsx scripts/realmap/generate.ts bath [sheffield ...]
//   npm run gen-maps
//
// See README.md for the tile encoding and the data licences.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png";
import { fillPolygon, Point, strokeLine } from "./raster";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "cache");
const ASSETS = join(HERE, "..", "..", "map-generator", "assets", "maps");
const TERRARIUM =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRARIUM_ZOOM = 15;
const METRES_PER_DEGREE = 111_320;

interface Town {
  name: string;
  lat: number;
  lon: number;
  sizeKm: number;
  metresPerTile: number;
}

// What each tile is, before it becomes terrain. Later paints win.
const enum Cls {
  Ground,
  Grass,
  Farm,
  Scrub,
  Wood,
  Paved,
  Path,
  Rail,
  Road,
  Building,
  Cliff,
  Steep,
  Water,
  Sea,
}

// Land magnitude per class: plus 0-6 for height on open ground. The horde
// moves at cost 1 + magnitude / 4 and is blocked from 20 (HordeField).
const HEIGHT_STEPS = 6;
const BASE_MAGNITUDE: Record<number, number> = {
  [Cls.Road]: 0,
  [Cls.Rail]: 0,
  [Cls.Paved]: 0,
  [Cls.Path]: 0,
  [Cls.Ground]: 4,
  [Cls.Grass]: 4,
  [Cls.Farm]: 4,
  [Cls.Scrub]: 8,
  [Cls.Wood]: 12,
};
const STEEP_MAGNITUDE = 22;
const BUILDING_MAGNITUDE = 30;
// A slope steeper than this (rise over run) is a natural wall.
const STEEP_SLOPE = 1.0;

// Road widths in metres; anything we don't list is a minor road.
const ROAD_WIDTH: Record<string, number> = {
  motorway: 14,
  trunk: 12,
  primary: 12,
  secondary: 10,
  tertiary: 9,
  residential: 8,
  unclassified: 8,
  living_street: 7,
  service: 6,
  unknown: 6,
};
const PATH_CLASSES = new Set([
  "footway",
  "path",
  "steps",
  "cycleway",
  "pedestrian",
  "track",
  "bridleway",
  "sidewalk",
  "crosswalk",
]);
const RIVER_WIDTH: Record<string, number> = { river: 12, canal: 9 };

type Geometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

interface Feature {
  properties: { kind: string; subtype?: string; class?: string };
  geometry: Geometry;
}

class Grid {
  readonly size: number;
  readonly cls: Uint8Array;
  private readonly cosLat: number;

  constructor(readonly town: Town) {
    const tiles = (town.sizeKm * 1000) / town.metresPerTile;
    this.size = Math.floor(tiles / 4) * 4; // the generator crops to 4s
    this.cls = new Uint8Array(this.size * this.size);
    this.cosLat = Math.cos((town.lat * Math.PI) / 180);
  }

  project([lon, lat]: number[]): Point {
    const k = METRES_PER_DEGREE / this.town.metresPerTile;
    return [
      (lon - this.town.lon) * this.cosLat * k + this.size / 2,
      (this.town.lat - lat) * k + this.size / 2,
    ];
  }

  unproject(x: number, y: number): [number, number] {
    const k = METRES_PER_DEGREE / this.town.metresPerTile;
    return [
      this.town.lon + (x - this.size / 2) / (this.cosLat * k),
      this.town.lat - (y - this.size / 2) / k,
    ];
  }

  fill(g: Geometry, paint: (i: number) => void): void {
    for (const rings of polygons(g)) {
      fillPolygon(
        rings.map((r) => r.map((c) => this.project(c))),
        this.size,
        this.size,
        (x, y) => paint(y * this.size + x),
      );
    }
  }

  stroke(g: Geometry, metres: number, paint: (i: number) => void): void {
    for (const line of lines(g)) {
      strokeLine(
        line.map((c) => this.project(c)),
        metres / this.town.metresPerTile,
        this.size,
        this.size,
        (x, y) => paint(y * this.size + x),
      );
    }
  }

  set(g: Geometry, c: Cls): void {
    this.fill(g, (i) => (this.cls[i] = c));
  }
}

function polygons(g: Geometry): number[][][][] {
  switch (g.type) {
    case "Polygon":
      return [g.coordinates];
    case "MultiPolygon":
      return g.coordinates;
    case "GeometryCollection":
      return g.geometries.flatMap(polygons);
    default:
      return [];
  }
}

function lines(g: Geometry): number[][][] {
  switch (g.type) {
    case "LineString":
      return [g.coordinates];
    case "MultiLineString":
      return g.coordinates;
    case "GeometryCollection":
      return g.geometries.flatMap(lines);
    default:
      return [];
  }
}

function paintFeatures(grid: Grid, features: Feature[]): void {
  const of = (kind: string) =>
    features.filter((f) => f.properties.kind === kind);

  // Ground cover first: satellite land cover, then mapped land use.
  for (const f of of("land_cover")) {
    const c = {
      forest: Cls.Wood,
      shrub: Cls.Scrub,
      crop: Cls.Farm,
      grass: Cls.Grass,
    }[f.properties.subtype ?? ""];
    if (c !== undefined) grid.set(f.geometry, c);
  }
  for (const f of of("land_use")) {
    const { subtype, class: cl } = f.properties;
    if (subtype === "agriculture") grid.set(f.geometry, Cls.Farm);
    else if (subtype === "pedestrian" || cl === "parking")
      grid.set(f.geometry, Cls.Paved);
    else if (
      [
        "park",
        "recreation",
        "golf",
        "cemetery",
        "managed",
        "horticulture",
      ].includes(subtype ?? "")
    )
      grid.set(f.geometry, Cls.Grass);
  }
  const land = of("land");
  for (const f of land) {
    const c = { forest: Cls.Wood, shrub: Cls.Scrub, grass: Cls.Grass }[
      f.properties.subtype ?? ""
    ];
    if (c !== undefined) grid.set(f.geometry, c);
  }

  // Water. Streams and drains are too small to stop anyone.
  for (const f of of("water")) {
    const { subtype, class: cl } = f.properties;
    if (cl === "swimming_pool" || cl === "fountain") continue;
    const c = subtype === "ocean" ? Cls.Sea : Cls.Water;
    grid.set(f.geometry, c);
    const w = RIVER_WIDTH[cl ?? ""];
    if (w !== undefined) grid.stroke(f.geometry, w, (i) => (grid.cls[i] = c));
  }
  // The sea is whatever the coastline's land polygons leave uncovered.
  const landMass = land.filter((f) => f.properties.subtype === "land");
  if (landMass.length > 0) {
    const onLand = new Uint8Array(grid.cls.length);
    for (const f of landMass) grid.fill(f.geometry, (i) => (onLand[i] = 1));
    for (let i = 0; i < onLand.length; i++) {
      if (!onLand[i]) grid.cls[i] = Cls.Sea;
    }
  }
  for (const f of land) {
    if (f.properties.class === "cliff") {
      grid.stroke(f.geometry, 2 * grid.town.metresPerTile, (i) => {
        if (grid.cls[i] !== Cls.Sea) grid.cls[i] = Cls.Cliff;
      });
    }
  }

  // Paths and rail go under buildings (arcades, covered stations); roads go
  // over everything, so every street stays open and bridges cross rivers.
  const segments = of("segment");
  for (const f of segments) {
    const { subtype, class: cl } = f.properties;
    if (subtype === "rail") {
      grid.stroke(f.geometry, 6, (i) => (grid.cls[i] = Cls.Rail));
    } else if (subtype === "road" && PATH_CLASSES.has(cl ?? "")) {
      grid.stroke(f.geometry, grid.town.metresPerTile, (i) => {
        if (grid.cls[i] < Cls.Water) grid.cls[i] = Cls.Path;
      });
    }
  }
  for (const f of of("building")) {
    grid.fill(f.geometry, (i) => {
      grid.cls[i] = Cls.Building;
    });
  }
  for (const f of segments) {
    const { subtype, class: cl } = f.properties;
    if (subtype !== "road" || PATH_CLASSES.has(cl ?? "")) continue;
    grid.stroke(f.geometry, ROAD_WIDTH[cl ?? ""] ?? 6, (i) => {
      grid.cls[i] = Cls.Road;
    });
  }
}

async function download(url: string, attempts = 4): Promise<Uint8Array> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function terrariumTile(x: number, y: number): Promise<Float32Array> {
  const path = join(CACHE, "terrarium", `${TERRARIUM_ZOOM}-${x}-${y}.png`);
  let bytes: Uint8Array;
  if (existsSync(path)) {
    bytes = readFileSync(path);
  } else {
    const url = TERRARIUM.replace("{z}", String(TERRARIUM_ZOOM))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    bytes = await download(url);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  const png = decodePng(bytes);
  const out = new Float32Array(png.width * png.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * png.channels;
    const [r, g, b] = [png.pixels[p], png.pixels[p + 1], png.pixels[p + 2]];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

/** Height in metres at the centre of every tile, bilinear from Terrarium. */
async function heights(grid: Grid): Promise<Float32Array> {
  const n = 2 ** TERRARIUM_ZOOM;
  const worldPx = (lon: number, lat: number): [number, number] => {
    const s = Math.sin((lat * Math.PI) / 180);
    return [
      ((lon + 180) / 360) * n * 256,
      (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256,
    ];
  };
  const [lon0, lat0] = grid.unproject(-1, -1);
  const [lon1, lat1] = grid.unproject(grid.size + 1, grid.size + 1);
  const [px0, py0] = worldPx(lon0, lat0);
  const [px1, py1] = worldPx(lon1, lat1);
  const tiles = new Map<string, Float32Array>();
  for (let ty = Math.floor(py0 / 256); ty <= Math.floor(py1 / 256); ty++) {
    for (let tx = Math.floor(px0 / 256); tx <= Math.floor(px1 / 256); tx++) {
      tiles.set(`${tx},${ty}`, await terrariumTile(tx, ty));
    }
  }
  const at = (px: number, py: number): number => {
    const t = tiles.get(`${Math.floor(px / 256)},${Math.floor(py / 256)}`)!;
    return t[(py & 255) * 256 + (px & 255)];
  };
  const out = new Float32Array(grid.size * grid.size);
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const [lon, lat] = grid.unproject(x + 0.5, y + 0.5);
      const [fx, fy] = worldPx(lon, lat);
      const ix = Math.floor(fx - 0.5);
      const iy = Math.floor(fy - 0.5);
      const ax = fx - 0.5 - ix;
      const ay = fy - 0.5 - iy;
      out[y * grid.size + x] =
        (at(ix, iy) * (1 - ax) + at(ix + 1, iy) * ax) * (1 - ay) +
        (at(ix, iy + 1) * (1 - ax) + at(ix + 1, iy + 1) * ax) * ay;
    }
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function markSteep(grid: Grid, h: Float32Array): number {
  const s = grid.size;
  const run = 2 * grid.town.metresPerTile;
  let count = 0;
  for (let y = 1; y < s - 1; y++) {
    for (let x = 1; x < s - 1; x++) {
      const i = y * s + x;
      const c = grid.cls[i];
      if (c >= Cls.Road) continue; // roads, buildings, water stay as they are
      const gx = (h[i + 1] - h[i - 1]) / run;
      const gy = (h[i + s] - h[i - s]) / run;
      if (gx * gx + gy * gy > STEEP_SLOPE * STEEP_SLOPE) {
        grid.cls[i] = Cls.Steep;
        count++;
      }
    }
  }
  return count;
}

const blocked = (c: number) => c >= Cls.Building;

/**
 * Fills in open ground the horde can't reach, such as courtyards walled in
 * by buildings, so nobody can put their HQ somewhere no zombie can go.
 * Works on the horde's own grid: the half-size map the Go generator makes
 * (a 2x2 block is water if any tile is, else it is its bottom-right tile),
 * where diagonal steps can't cut corners, so 4-connected. Everything outside
 * the largest open area becomes building. Returns the tiles filled.
 */
function fillPockets(grid: Grid): number {
  const s = grid.size;
  const m = s / 2;
  const open = new Uint8Array(m * m);
  for (let my = 0; my < m; my++) {
    for (let mx = 0; mx < m; mx++) {
      const i = 2 * my * s + 2 * mx;
      const block = [i, i + 1, i + s, i + s + 1].map((t) => grid.cls[t]);
      const water = block.some((c) => c === Cls.Water || c === Cls.Sea);
      open[my * m + mx] = !water && !blocked(block[3]) ? 1 : 0;
    }
  }
  const area = new Int32Array(m * m).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < open.length; start++) {
    if (!open[start] || area[start] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    area[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const c = stack.pop()!;
      size++;
      const x = c % m;
      const next = [
        x > 0 ? c - 1 : -1,
        x < m - 1 ? c + 1 : -1,
        c - m,
        c + m < m * m ? c + m : -1,
      ];
      for (const n of next) {
        if (n >= 0 && open[n] && area[n] < 0) {
          area[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  let filled = 0;
  for (let c = 0; c < open.length; c++) {
    if (area[c] < 0 || area[c] === main) continue;
    const i = 2 * Math.floor(c / m) * s + 2 * (c % m);
    for (const t of [i, i + 1, i + s, i + s + 1]) {
      if (blocked(grid.cls[t])) continue;
      grid.cls[t] = Cls.Building;
      filled++;
    }
  }
  return filled;
}

/** image.png for the Go generator: only the blue channel matters. */
function terrainImage(grid: Grid, h: Float32Array): Uint8Array {
  const lo = percentile(h, 0.02);
  const hi = percentile(h, 0.98);
  const out = new Uint8Array(grid.cls.length * 4);
  for (let i = 0; i < grid.cls.length; i++) {
    const c = grid.cls[i];
    let blue: number;
    if (c === Cls.Water || c === Cls.Sea) {
      blue = 106;
    } else {
      let mag: number;
      if (c === Cls.Building) mag = BUILDING_MAGNITUDE;
      else if (c === Cls.Cliff || c === Cls.Steep) mag = STEEP_MAGNITUDE;
      else {
        const t = hi > lo ? (h[i] - lo) / (hi - lo) : 0;
        const step = Math.round(Math.min(1, Math.max(0, t)) * HEIGHT_STEPS);
        mag = BASE_MAGNITUDE[c] + (c === Cls.Wood ? step >> 1 : step);
      }
      blue = 140 + 2 * mag;
    }
    out.set([blue, blue, blue, 255], i * 4);
  }
  return out;
}

// Light shades: the horde walks fastest on roads (see the horde palette in
// src/client/render/gl/utils/HordeTerrainColors.ts).
const ROAD_COLOURS: Partial<Record<Cls, [number, number, number]>> = {
  [Cls.Road]: [241, 239, 232],
  [Cls.Paved]: [232, 229, 220],
  [Cls.Path]: [230, 220, 196],
  [Cls.Rail]: [207, 200, 188],
};

const BLOCKED = new Set<Cls>([Cls.Building, Cls.Cliff, Cls.Steep]);
const WET = new Set<Cls>([Cls.Water, Cls.Sea]);

/**
 * Whether the horde's 2x2 cell holding tile (x, y) is blocked. Mirrors the
 * Go generator's createMiniMap: water anywhere in the cell wins, otherwise
 * the cell takes its bottom-right tile.
 */
function cellBlocked(grid: Grid, x: number, y: number): boolean {
  const s = grid.size;
  const x0 = x & ~1;
  const y0 = y & ~1;
  if (x0 + 1 >= s || y0 + 1 >= s) return true;
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    if (WET.has(grid.cls[(y0 + dy) * s + x0 + dx] as Cls)) return true;
  }
  return BLOCKED.has(grid.cls[(y0 + 1) * s + x0 + 1] as Cls);
}

/**
 * The roads layer: streets, paths, rail and paved squares. Left out where
 * the horde's cell is blocked, so a road never paints over a building.
 * Buildings have no layer: the client draws blocked cells itself.
 */
function roadsLayer(grid: Grid): Uint8Array {
  const s = grid.size;
  const out = new Uint8Array(grid.cls.length * 4);
  for (let i = 0; i < grid.cls.length; i++) {
    const rgb = ROAD_COLOURS[grid.cls[i] as Cls];
    if (rgb && !cellBlocked(grid, i % s, Math.floor(i / s))) {
      out.set([...rgb, 255], i * 4);
    }
  }
  return out;
}

async function generate(key: string, town: Town): Promise<void> {
  const geojson = join(CACHE, `${key}.geojson`);
  if (!existsSync(geojson)) {
    throw new Error(
      `${geojson} is missing: run python3 scripts/realmap/fetch_overture.py --town ${key}`,
    );
  }
  const { features } = JSON.parse(readFileSync(geojson, "utf8")) as {
    features: Feature[];
  };
  const grid = new Grid(town);
  paintFeatures(grid, features);
  const h = await heights(grid);
  const steep = markSteep(grid, h);
  const pockets = fillPockets(grid);

  const counts = new Map<number, number>();
  for (const c of grid.cls) counts.set(c, (counts.get(c) ?? 0) + 1);
  const pct = (c: Cls) =>
    `${(((counts.get(c) ?? 0) * 100) / grid.cls.length).toFixed(1)}%`;
  console.log(
    `${town.name}: ${grid.size}x${grid.size} tiles, buildings ${pct(Cls.Building)},` +
      ` roads ${pct(Cls.Road)}, water ${pct(Cls.Water)}, sea ${pct(Cls.Sea)},` +
      ` steep ${steep} tiles, pockets filled ${pockets} tiles, height ${percentile(h, 0.02).toFixed(0)}-` +
      `${percentile(h, 0.98).toFixed(0)} m`,
  );

  const dir = join(ASSETS, key);
  mkdirSync(dir, { recursive: true });
  const png = (data: Uint8Array) => encodePng(grid.size, grid.size, data);
  writeFileSync(join(dir, "image.png"), png(terrainImage(grid, h)));
  writeFileSync(join(dir, "roads.png"), png(roadsLayer(grid)));
  const id = town.name.replace(/[^A-Za-z0-9]/g, "");
  const info = {
    id,
    name: town.name,
    translation_key: `map.${key}`,
    categories: ["new", "europe"],
    multiplayer_frequency: 0,
    layers: [{ id: "roads", placement: "land" }],
    nations: [],
  };
  writeFileSync(join(dir, "info.json"), JSON.stringify(info, null, 2) + "\n");
}

const towns = JSON.parse(
  readFileSync(join(HERE, "towns.json"), "utf8"),
) as Record<string, Town>;
const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.error(`usage: generate.ts <town>... (one of ${Object.keys(towns)})`);
  process.exit(1);
}
for (const key of keys) {
  const town = towns[key];
  if (!town) throw new Error(`unknown town ${key}`);
  await generate(key, town);
}
