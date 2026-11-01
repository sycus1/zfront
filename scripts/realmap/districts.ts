// First cut of a town's hand-made districts (zfront): writes
// map-generator/assets/maps/<town>/districts.png, one flat colour per
// district, from the town's generated terrain. The map generator reads it
// back into the manifest (map-generator/districts.go). Repaint the PNG by
// hand as you like; this only gives a starting point.
//
//   npm run gen-maps     # the town's terrain must be generated first
//   npx tsx scripts/realmap/districts.ts bath [sheffield ...] [--size 25] [--preview <dir>]
//   npm run gen-maps     # writes the districts into the manifest
//
// How the cut is made, on the horde's coarse grid (2x2 tiles a cell):
//
// 1. Clearance: how far each open cell is from the nearest blocked one
//    (buildings, water, cliffs), so a narrow street scores 1 and a square 4+.
// 2. One seed per `size` x `size` block, at its most open cell. Blocks that
//    are nearly all buildings or water get none.
// 3. Districts grow from the seeds along open ground, slowly through narrow
//    cells and fast through wide ones, so two districts meet in the narrow
//    part of a street rather than at a junction or in a square: each border
//    crosses streets where they are narrowest, a chokepoint. A few rounds of
//    moving each seed to its district's middle even out the sizes.
// 4. Tiny districts join the neighbour they share most border with.
// 5. Buildings and water join the nearest district, so borders run through
//    the middle of blocks.

import { buildDistricts } from "@openfront/engine-lib/game/Districts";
import { hordeMoveCost } from "@openfront/engine-lib/game/HordeTerrain";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const ASSETS = join(ROOT, "map-generator", "assets", "maps");
const MAPS = join(ROOT, "resources", "maps");

/** Clearance (cells) from which ground counts as wide open. */
const WIDE = 4;
/** Extra cost per cell of clearance short of WIDE. */
const NARROW_COST = 3;
/** Rounds of moving seeds to the middle of their district. */
const ROUNDS = 6;
/** Blocks with less open ground than this share of their area get no seed. */
const MIN_SEED_OPEN = 0.12;
/** Districts with less open ground than this share of the mean are merged. */
const MIN_DISTRICT_OPEN = 0.35;

export interface Cut {
  ids: Int32Array;
  count: number;
}

/** Cuts a `w` x `h` grid of open (1) and blocked (0) cells into districts. */
export function cutDistricts(
  open: Uint8Array,
  w: number,
  h: number,
  size: number,
): Cut {
  const n = w * h;
  const clear = clearance(open, w, h);
  const step = new Int32Array(n);
  for (let c = 0; c < n; c++) {
    step[c] = 1 + NARROW_COST * Math.max(0, WIDE - clear[c]);
  }

  let seeds: number[] = [];
  for (let by = 0; by < h; by += size) {
    for (let bx = 0; bx < w; bx += size) {
      let best = -1;
      let openCells = 0;
      const cx = bx + size / 2;
      const cy = by + size / 2;
      let bestScore = -Infinity;
      for (let y = by; y < Math.min(h, by + size); y++) {
        for (let x = bx; x < Math.min(w, bx + size); x++) {
          const c = y * w + x;
          if (!open[c]) continue;
          openCells++;
          // Most open first, then nearest the block's middle.
          const score =
            clear[c] * 10_000 - ((x - cx) * (x - cx) + (y - cy) * (y - cy));
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
      }
      if (best >= 0 && openCells >= size * size * MIN_SEED_OPEN) {
        seeds.push(best);
      }
    }
  }
  if (seeds.length === 0) throw new Error("no open ground to cut");

  let labels = grow(seeds, open, step, w, h);
  for (let round = 0; round < ROUNDS; round++) {
    seeds = recentre(seeds.length, labels, open, w, h);
    labels = grow(seeds, open, step, w, h);
  }
  labels = mergeSmall(labels, open, w, h);
  fillNearest(labels, w, h);
  return renumber(labels);
}

/** Chessboard distance from each cell to the nearest blocked one, capped. */
function clearance(open: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const cap = WIDE + 2;
  const d = new Int32Array(n).fill(cap);
  const queue: number[] = [];
  for (let c = 0; c < n; c++) {
    if (!open[c]) {
      d[c] = 0;
      queue.push(c);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const x = c % w;
    const y = (c - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nc = ny * w + nx;
        if (d[nc] > d[c] + 1) {
          d[nc] = d[c] + 1;
          queue.push(nc);
        }
      }
    }
  }
  return d;
}

/**
 * Grows a district from each seed over open cells, cheapest path first
 * (a geodesic Voronoi). Cells no seed reaches stay -1.
 */
function grow(
  seeds: number[],
  open: Uint8Array,
  step: Int32Array,
  w: number,
  h: number,
): Int32Array {
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const label = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  seeds.forEach((s, k) => {
    dist[s] = 0;
    label[s] = k;
    heap.push(s);
  });
  while (heap.size > 0) {
    const key = heap.pop();
    const c = key % n;
    const d = (key - c) / n;
    if (d > dist[c]) continue;
    const x = c % w;
    const y = (c - x) / w;
    const nbrs = [
      y > 0 ? c - w : -1,
      x > 0 ? c - 1 : -1,
      x + 1 < w ? c + 1 : -1,
      y + 1 < h ? c + w : -1,
    ];
    for (const nc of nbrs) {
      if (nc < 0 || !open[nc]) continue;
      const nd = d + step[nc];
      if (nd < dist[nc]) {
        dist[nc] = nd;
        label[nc] = label[c];
        heap.push(nc + nd * n);
      }
    }
  }
  return label;
}

/** Each district's open cell nearest its middle, as next round's seeds. */
function recentre(
  count: number,
  labels: Int32Array,
  open: Uint8Array,
  w: number,
  h: number,
): number[] {
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  const m = new Int32Array(count);
  for (let c = 0; c < w * h; c++) {
    const k = labels[c];
    if (k < 0) continue;
    sx[k] += c % w;
    sy[k] += Math.floor(c / w);
    m[k]++;
  }
  const best = new Int32Array(count).fill(-1);
  const bestD = new Float64Array(count).fill(Infinity);
  for (let c = 0; c < w * h; c++) {
    const k = labels[c];
    if (k < 0 || !open[c]) continue;
    const dx = (c % w) - sx[k] / m[k];
    const dy = Math.floor(c / w) - sy[k] / m[k];
    const d = dx * dx + dy * dy;
    if (d < bestD[k]) {
      bestD[k] = d;
      best[k] = c;
    }
  }
  return [...best].filter((c) => c >= 0);
}

/**
 * Folds each district with too little open ground into the neighbour it
 * shares the most border with, smallest first, until none is left.
 */
function mergeSmall(
  labels: Int32Array,
  open: Uint8Array,
  w: number,
  h: number,
): Int32Array {
  for (;;) {
    const sizes = new Map<number, number>();
    for (const k of labels) if (k >= 0) sizes.set(k, (sizes.get(k) ?? 0) + 1);
    const mean = [...sizes.values()].reduce((a, b) => a + b, 0) / sizes.size;
    let small = -1;
    let smallSize = Infinity;
    for (const [k, s] of [...sizes].sort((a, b) => a[0] - b[0])) {
      if (s < mean * MIN_DISTRICT_OPEN && s < smallSize) {
        small = k;
        smallSize = s;
      }
    }
    if (small < 0 || sizes.size <= 1) return labels;
    const shared = new Map<number, number>();
    for (let c = 0; c < w * h; c++) {
      if (labels[c] !== small || !open[c]) continue;
      const x = c % w;
      const y = (c - x) / w;
      for (const nc of [
        y > 0 ? c - w : -1,
        x > 0 ? c - 1 : -1,
        x + 1 < w ? c + 1 : -1,
        y + 1 < h ? c + w : -1,
      ]) {
        const k = nc < 0 ? -1 : labels[nc];
        if (k >= 0 && k !== small) shared.set(k, (shared.get(k) ?? 0) + 1);
      }
    }
    let into = -1;
    let most = 0;
    for (const [k, s] of [...shared].sort((a, b) => a[0] - b[0])) {
      if (s > most) {
        most = s;
        into = k;
      }
    }
    // Cut off from everything (an island): it stays as it is.
    if (into < 0) {
      for (let c = 0; c < w * h; c++) if (labels[c] === small) labels[c] = -2;
      continue;
    }
    for (let c = 0; c < w * h; c++) if (labels[c] === small) labels[c] = into;
  }
}

/** Gives each unlabelled cell (< 0) the label of the nearest labelled one. */
function fillNearest(labels: Int32Array, w: number, h: number): void {
  const queue: number[] = [];
  for (let c = 0; c < w * h; c++) {
    if (labels[c] === -2) labels[c] = -1;
  }
  for (let c = 0; c < w * h; c++) if (labels[c] >= 0) queue.push(c);
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const x = c % w;
    const y = (c - x) / w;
    for (const nc of [
      y > 0 ? c - w : -1,
      x > 0 ? c - 1 : -1,
      x + 1 < w ? c + 1 : -1,
      y + 1 < h ? c + w : -1,
    ]) {
      if (nc >= 0 && labels[nc] < 0) {
        labels[nc] = labels[c];
        queue.push(nc);
      }
    }
  }
}

/** Ids 0.. in order of first appearance, row by row (as the generator reads them). */
function renumber(labels: Int32Array): Cut {
  const map = new Map<number, number>();
  const ids = new Int32Array(labels.length);
  for (let c = 0; c < labels.length; c++) {
    let id = map.get(labels[c]);
    if (id === undefined) {
      id = map.size;
      map.set(labels[c], id);
    }
    ids[c] = id;
  }
  return { ids, count: map.size };
}

/** Open cells with an open 4-neighbour in another district: where walls would go. */
export function openBorderCells(
  ids: ArrayLike<number>,
  open: Uint8Array,
  w: number,
  h: number,
): number {
  let count = 0;
  for (let c = 0; c < w * h; c++) {
    if (!open[c]) continue;
    const x = c % w;
    const y = (c - x) / w;
    for (const nc of [
      y > 0 ? c - w : -1,
      x > 0 ? c - 1 : -1,
      x + 1 < w ? c + 1 : -1,
      y + 1 < h ? c + w : -1,
    ]) {
      if (nc >= 0 && open[nc] && ids[nc] !== ids[c]) {
        count++;
        break;
      }
    }
  }
  return count;
}

/** A distinct colour per district, spread round the hue wheel. */
function colours(count: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let j = i;
    for (;;) {
      const hue = (j * 137.508) % 360;
      const light = [0.5, 0.62, 0.42][j % 3];
      const rgb = hsl(hue, 0.65, light);
      const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      if (!used.has(key)) {
        used.add(key);
        out.push(rgb);
        break;
      }
      j += count;
    }
  }
  return out;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

class MinHeap {
  private a: number[] = [];
  get size(): number {
    return this.a.length;
  }
  push(v: number): void {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= v) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = v;
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const m = r < a.length && a[r] < a[l] ? r : l;
        if (a[m] >= last) break;
        a[i] = a[m];
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

function run(town: string, size: number, preview: string | null): void {
  const mapDir = join(MAPS, town);
  const manifest = JSON.parse(
    readFileSync(join(mapDir, "manifest.json"), "utf8"),
  );
  const w: number = manifest.map4x.width;
  const h: number = manifest.map4x.height;
  const terrain = readFileSync(join(mapDir, "map4x.bin"));
  const open = new Uint8Array(w * h);
  for (let c = 0; c < w * h; c++)
    open[c] = hordeMoveCost(terrain[c]) !== 0 ? 1 : 0;

  const cut = cutDistricts(open, w, h, size);
  const palette = colours(cut.count);
  const W = manifest.map.width;
  const H = manifest.map.height;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = cut.ids[Math.min(h - 1, y >> 1) * w + Math.min(w - 1, x >> 1)];
      const o = (y * W + x) * 4;
      rgba.set(palette[id], o);
      rgba[o + 3] = 255;
    }
  }
  const dir = join(ASSETS, town);
  writeFileSync(join(dir, "districts.png"), encodePng(W, H, rgba));

  const sizes = new Array(cut.count).fill(0);
  for (let c = 0; c < w * h; c++) if (open[c]) sizes[cut.ids[c]]++;
  sizes.sort((a, b) => a - b);
  const grid = buildDistricts(w, h, size);
  const ours = openBorderCells(cut.ids, open, w, h);
  const theirs = openBorderCells(grid.ids, open, w, h);
  console.log(
    `${town}: ${cut.count} districts (grid: ${grid.count}), open cells each ` +
      `${sizes[0]}..${sizes[sizes.length >> 1]}..${sizes[sizes.length - 1]}; ` +
      `open border cells ${ours} (grid: ${theirs}), ` +
      `${(ours / cut.count).toFixed(1)} a district (grid: ${(theirs / grid.count).toFixed(1)})`,
  );

  if (preview !== null) {
    mkdirSync(preview, { recursive: true });
    writeFileSync(
      join(preview, `${town}-districts.png`),
      encodePng(W, H, previewImage(cut, palette, open, terrain, w, h, W, H)),
    );
  }
}

/** The districts tinted over the terrain, with their borders drawn dark. */
function previewImage(
  cut: Cut,
  palette: [number, number, number][],
  open: Uint8Array,
  terrain: Uint8Array,
  w: number,
  h: number,
  W: number,
  H: number,
): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = Math.min(w - 1, x >> 1);
      const cy = Math.min(h - 1, y >> 1);
      const c = cy * w + cx;
      const id = cut.ids[c];
      const water = (terrain[c] & 0x80) === 0;
      const base: [number, number, number] = water
        ? [70, 110, 160]
        : open[c]
          ? [235, 232, 222]
          : [120, 116, 110];
      const tint = palette[id];
      const border =
        (cx > 0 && cut.ids[c - 1] !== id && (x & 1) === 0) ||
        (cy > 0 && cut.ids[c - w] !== id && (y & 1) === 0);
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        rgba[o + k] = border
          ? open[c]
            ? 200 * (k === 0 ? 1 : 0)
            : 30
          : Math.round(base[k] * 0.6 + tint[k] * 0.4);
      }
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

const args = process.argv.slice(2);
let size = 25;
let preview: string | null = null;
const towns: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--size") size = Number(args[++i]);
  else if (args[i] === "--preview") preview = args[++i];
  else towns.push(args[i].toLowerCase());
}
if (towns.length === 0 || !(size > 0)) {
  console.error(
    "usage: npx tsx scripts/realmap/districts.ts <town> [...] [--size 25] [--preview <dir>]",
  );
  process.exit(1);
}
for (const town of towns) {
  if (!existsSync(join(MAPS, town, "map4x.bin"))) {
    console.error(
      `${town}: no resources/maps/${town}/map4x.bin; run npm run gen-maps first`,
    );
    process.exit(1);
  }
  run(town, size, preview);
}
