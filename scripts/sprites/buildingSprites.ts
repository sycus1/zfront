// Draws zfront's pixel-art building sprites and writes the two atlases the
// renderer loads:
//
//   resources/atlases/building-sprites.png  FRAME x FRAME per building, in
//     BUILDING_ORDER. Row 0 is the colour; row 1 is the owner mask, whose red
//     channel is how bright the owner's colour is drawn there (128 = as is),
//     and whose alpha marks the pixels to tint.
//   resources/atlases/cell-sprites.png  CELL x CELL per one-cell building, in
//     CELL_ORDER (walls, mines, beacons, depots: one horde cell, 2x2 tiles).
//
// Every pixel is placed here, at the sprite's own resolution: no smoothing,
// a small palette, a dark outline and a hard drop shadow added at the end.
// Run with:  npx tsx scripts/sprites/buildingSprites.ts [previewDir]
// and commit the two PNGs. The column orders must match StructurePass.ts and
// horde.frag.glsl.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../realmap/png";

export const FRAME = 40;
export const CELL = 8;

export const BUILDING_ORDER = [
  "City",
  "Port",
  "Factory",
  "Defense Post",
  "SAM Launcher",
  "Missile Silo",
  "Outpost",
  "HQ",
] as const;

export const CELL_ORDER = [
  "wall1",
  "wall2",
  "wall3",
  "mine",
  "beacon",
  "beaconOn",
  "depot",
] as const;

type RGB = [number, number, number];
const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// The palette. Light comes from the top left.
const P = {
  ink: hex("#2a2520"),
  bagHi: hex("#e0cd98"),
  bag: hex("#c4ad72"),
  bagLo: hex("#97834f"),
  conHi: hex("#bcbab0"),
  con: hex("#a09e93"),
  conLo: hex("#7f7d73"),
  stHi: hex("#94a1ae"),
  st: hex("#66727f"),
  stLo: hex("#454e59"),
  stDk: hex("#2b3138"),
  woodHi: hex("#cfa165"),
  wood: hex("#a97d47"),
  woodLo: hex("#7d5932"),
  woodDk: hex("#5a3e22"),
  slateHi: hex("#aebac8"),
  slate: hex("#8592a2"),
  slateLo: hex("#5f6a79"),
  ochreHi: hex("#e3bd7c"),
  ochre: hex("#bf9455"),
  ochreLo: hex("#916c39"),
  grass: hex("#97ad69"),
  grassLo: hex("#748c4d"),
  bush: hex("#5b7a39"),
  bushHi: hex("#7d9c4f"),
  olive: hex("#6e7c41"),
  oliveLo: hex("#4b5630"),
  earth: hex("#75603f"),
  earthLo: hex("#5b4a30"),
  brick: hex("#9a6a52"),
  yellow: hex("#e8bb3c"),
  yellowLo: hex("#b38a22"),
  red: hex("#ee3f28"),
  redHi: hex("#ffb4a0"),
  hole: hex("#17140f"),
  blue: hex("#4f86c6"),
  blueHi: hex("#9cc4f0"),
};

class Sprite {
  rgba: Uint8Array;
  mask: Uint8Array; // owner brightness per pixel, 0 = not owner-coloured
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.rgba = new Uint8Array(w * h * 4);
    this.mask = new Uint8Array(w * h);
  }
  px(x: number, y: number, c: RGB, a = 255): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.rgba.set([c[0], c[1], c[2], a], i);
    this.mask[y * this.w + x] = 0;
  }
  /** An owner-coloured pixel, `shade` 128 = the owner's colour as is. */
  team(x: number, y: number, shade = 128): void {
    this.px(x, y, [160, 160, 160]);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h)
      this.mask[y * this.w + x] = shade;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  teamRect(x: number, y: number, w: number, h: number, shade = 128): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.team(x + i, y + j, shade);
  }
  /** Rectangle with a lit top/left edge and a dark bottom/right edge. */
  box(x: number, y: number, w: number, h: number, hi: RGB, c: RGB, lo: RGB) {
    this.rect(x, y, w, h, c);
    this.rect(x, y, w, 1, hi);
    this.rect(x, y, 1, h, hi);
    this.rect(x, y + h - 1, w, 1, lo);
    this.rect(x + w - 1, y, 1, h, lo);
  }
  frame(x: number, y: number, w: number, h: number, c: RGB): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }
  /** Disc centred on (cx, cy) (pixel corners), radius r. */
  disc(
    cx: number,
    cy: number,
    r: number,
    c: RGB | ((x: number, y: number) => RGB | null),
  ) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) {
          const col = typeof c === "function" ? c(x, y) : c;
          if (col) this.px(x, y, col);
        }
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++)
      this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  /** A thick line from (x0, y0) to (x1, y1); `c` gets the signed distance across it. */
  capsule(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    c: (side: number) => RGB,
  ) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (
      let y = Math.floor(Math.min(y0, y1) - r);
      y <= Math.ceil(Math.max(y0, y1) + r);
      y++
    )
      for (
        let x = Math.floor(Math.min(x0, x1) - r);
        x <= Math.ceil(Math.max(x0, x1) + r);
        x++
      ) {
        const px = x + 0.5 - x0;
        const py = y + 0.5 - y0;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        if (ex * ex + ey * ey > r * r) continue;
        this.px(x, y, c((px * dy - py * dx) / Math.sqrt(len2)));
      }
  }
  opaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.rgba[(y * this.w + x) * 4 + 3] === 255;
  }
  /** A 1px dark outline round the silhouette, then a hard 2px shadow. */
  finish(shadow = true): this {
    const edge: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.opaque(x, y)) continue;
        if (
          this.opaque(x - 1, y) ||
          this.opaque(x + 1, y) ||
          this.opaque(x, y - 1) ||
          this.opaque(x, y + 1)
        )
          edge.push(x, y);
      }
    for (let i = 0; i < edge.length; i += 2)
      this.px(edge[i], edge[i + 1], P.ink);
    if (shadow) {
      const shade: number[] = [];
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < this.w; x++)
          if (
            !this.opaque(x, y) &&
            (this.opaque(x - 1, y - 1) || this.opaque(x - 2, y - 2))
          )
            shade.push(x, y);
      for (let i = 0; i < shade.length; i += 2)
        this.px(shade[i], shade[i + 1], [20, 16, 10], 92);
    }
    return this;
  }
}

/** Sandbags along a closed path of points: alternating light and dark bags. */
function bags(s: Sprite, pts: [number, number][]): void {
  pts.forEach(([x, y], i) => {
    const k = i % 3;
    s.px(x, y, k === 0 ? P.bagLo : k === 1 ? P.bagHi : P.bag);
  });
}

function ring(cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.round(2 * Math.PI * r);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out.push([
      Math.floor(cx + r * Math.cos(a)),
      Math.floor(cy + r * Math.sin(a)),
    ]);
  }
  return out;
}

/** The points round a w x h rectangle with cut corners, clockwise. */
function roundRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < w - 1; i++) out.push([x + i, y]);
  for (let j = 1; j < h - 1; j++) out.push([x + w - 1, y + j]);
  for (let i = w - 2; i >= 1; i--) out.push([x + i, y + h - 1]);
  for (let j = h - 2; j >= 1; j--) out.push([x, y + j]);
  return out;
}

function sandbagWall(s: Sprite, x: number, y: number, w: number, h: number) {
  // Two bags thick: an outer and an inner course.
  for (let k = 0; k < 2; k++)
    bags(s, roundRectPath(x + k, y + k, w - 2 * k, h - 2 * k));
}

function flag(s: Sprite, x: number, y: number): void {
  s.rect(x, y - 7, 1, 8, P.woodDk);
  s.teamRect(x + 1, y - 7, 3, 1, 160);
  s.teamRect(x + 1, y - 6, 4, 1, 128);
  s.teamRect(x + 1, y - 5, 3, 1, 100);
}

// ---------------------------------------------------------------------------
// Buildings (FRAME x FRAME, art centred)
// ---------------------------------------------------------------------------

function turret(): Sprite {
  const s = new Sprite(FRAME, FRAME);
  const c = 20;
  // Sandbag ring, then the concrete pad inside it.
  s.disc(c, c + 1, 12, P.bag);
  for (const r of [11.5, 10.5]) bags(s, ring(c, c + 1, r));
  s.disc(c, c + 1, 9.5, (x, y) =>
    (x + y) % 7 === 0 ? P.conLo : (x - y) % 9 === 0 ? P.conHi : P.con,
  );
  // Ammo box.
  s.box(25, 24, 5, 4, P.olive, P.olive, P.oliveLo);
  s.px(26, 25, P.yellow);
  // Barrel up to the muzzle, then the turret body.
  s.rect(19, 5, 3, 13, P.st);
  s.rect(19, 5, 1, 13, P.stHi);
  s.rect(21, 5, 1, 13, P.stLo);
  s.rect(18, 4, 5, 2, P.stDk);
  s.disc(c + 0.5, c + 1.5, 5.5, P.st);
  s.disc(c + 0.5, c + 1.5, 5.5, (x, y) => {
    const dx = x + 0.5 - (c + 0.5);
    const dy = y + 0.5 - (c + 1.5);
    const d = Math.hypot(dx, dy);
    if (d > 4.4) return null; // keep the outer ring for the owner colour
    return dx + dy < -2.5 ? P.stHi : dx + dy > 3 ? P.stLo : P.st;
  });
  for (let y = 0; y < FRAME; y++)
    for (let x = 0; x < FRAME; x++) {
      const d = Math.hypot(x + 0.5 - (c + 0.5), y + 0.5 - (c + 1.5));
      if (d > 4.4 && d <= 5.5) s.team(x, y, x + y < 2 * c + 1 ? 150 : 110);
    }
  s.px(19, 20, P.stHi);
  return s.finish();
}

function mortar(): Sprite {
  const s = new Sprite(FRAME, FRAME);
  // Pit with a sandbag rim.
  s.rect(6, 7, 28, 27, P.earth);
  sandbagWall(s, 5, 6, 30, 29);
  for (let y = 9; y < 32; y++)
    for (let x = 8; x < 32; x++)
      if ((x * 7 + y * 3) % 11 === 0) s.px(x, y, P.earthLo);
  // Base plate.
  s.disc(18, 23, 4, P.stLo);
  s.disc(18, 23, 2.5, P.st);
  // Bipod.
  s.line(23, 16, 19, 13, P.stDk);
  s.line(23, 16, 27, 19, P.stDk);
  // Tube: a fat barrel from the plate up and to the left, lit on its
  // north-east side, with a dark bore at the muzzle.
  s.capsule(18, 23, 12, 13, 2.4, (side) =>
    side < -0.8 ? hex("#8f9f5a") : side > 0.9 ? P.oliveLo : P.olive,
  );
  s.disc(12, 12.5, 2.4, P.oliveLo);
  s.disc(12, 12.5, 1.4, P.hole);
  // Shells and a crate.
  for (const y of [25, 28]) {
    s.rect(25, y, 5, 2, P.olive);
    s.rect(30, y, 1, 2, P.yellow);
  }
  s.box(25, 9, 5, 4, P.woodHi, P.wood, P.woodLo);
  s.teamRect(9, 29, 3, 2, 128);
  return s.finish();
}

function outpost(): Sprite {
  const s = new Sprite(FRAME, FRAME);
  // Platform of planks.
  s.rect(8, 9, 24, 23, P.wood);
  for (let y = 9; y < 32; y += 3) s.rect(8, y, 24, 1, P.woodLo);
  for (let y = 10; y < 32; y += 3) s.rect(8, y, 24, 1, P.woodHi);
  // Pyramid roof, four shaded faces.
  const x0 = 11,
    y0 = 11,
    n = 18,
    m = n / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const dx = i - m + 0.5;
      const dy = j - m + 0.5;
      let c: RGB;
      if (Math.abs(dx) > Math.abs(dy)) c = dx < 0 ? P.ochreHi : P.ochreLo;
      else c = dy < 0 ? P.ochre : hex("#7d5d30");
      if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6) c = P.woodDk;
      s.px(x0 + i, y0 + j, c);
    }
  // Corner posts and a ladder.
  for (const [x, y] of [
    [7, 8],
    [30, 8],
    [7, 30],
    [30, 30],
  ])
    s.rect(x, y, 3, 3, P.woodDk);
  s.rect(17, 32, 1, 5, P.woodDk);
  s.rect(22, 32, 1, 5, P.woodDk);
  s.rect(18, 33, 4, 1, P.wood);
  s.rect(18, 35, 4, 1, P.wood);
  flag(s, 20, 19);
  return s.finish();
}

function house(
  s: Sprite,
  x: number,
  y: number,
  w: number,
  h: number,
  hi: RGB,
  c: RGB,
  lo: RGB,
) {
  // Ridge runs top to bottom: lit west slope, shaded east slope.
  const m = Math.floor(w / 2);
  s.rect(x, y, m, h, hi);
  s.rect(x + m, y, w - m, h, c);
  s.rect(x + m, y, 1, h, lo);
  s.rect(x, y + h - 1, w, 1, lo);
  s.rect(x + w - 1, y, 1, h, lo);
  // Chimney.
  s.box(x + 1, y + 2, 2, 2, P.brick, P.brick, P.ink);
}

function city(): Sprite {
  const s = new Sprite(FRAME, FRAME);
  // Back gardens.
  s.rect(3, 8, 34, 26, P.grass);
  for (let y = 8; y < 34; y++)
    for (let x = 3; x < 37; x++)
      if ((x * 5 + y * 3) % 13 === 0) s.px(x, y, P.grassLo);
  // Three terraced houses.
  house(s, 4, 9, 10, 14, P.ochreHi, P.ochre, P.ochreLo);
  house(s, 15, 9, 10, 14, P.slateHi, P.slate, P.slateLo);
  house(s, 26, 9, 10, 14, P.ochreHi, P.ochre, P.ochreLo);
  // Garden paths, fences and bushes.
  for (const x of [8, 19, 30]) s.rect(x, 23, 2, 10, hex("#d6d0bd"));
  for (const [x, y] of [
    [5, 28],
    [13, 30],
    [23, 27],
    [33, 29],
  ]) {
    s.disc(x, y, 2.2, P.bush);
    s.px(x - 1, y - 1, P.bushHi);
  }
  // Owner-coloured front doors.
  for (const x of [8, 19, 30]) s.teamRect(x, 22, 2, 1, 128);
  return s.finish();
}

function factory(): Sprite {
  const s = new Sprite(FRAME, FRAME);
  // Concrete yard.
  s.rect(2, 6, 36, 29, P.con);
  for (let y = 6; y < 35; y++)
    for (let x = 2; x < 38; x++)
      if ((x * 3 + y * 7) % 17 === 0) s.px(x, y, P.conLo);
  // Sawtooth shed: lit glazing strip, then a dark roof slope, repeated.
  s.rect(4, 8, 24, 18, P.st);
  for (let x = 4; x < 28; x += 4) {
    s.rect(x, 8, 1, 18, P.blueHi);
    s.rect(x + 1, 8, 1, 18, P.stHi);
    s.rect(x + 3, 8, 1, 18, P.stLo);
  }
  s.frame(3, 7, 26, 20, P.ink);
  s.teamRect(4, 25, 24, 1, 128);
  // Chimney.
  s.disc(33, 11, 3.5, P.brick);
  s.disc(33, 11, 2, P.hole);
  s.px(31, 9, hex("#c08a70"));
  // Pallets of goods.
  for (const [x, y] of [
    [5, 29],
    [12, 29],
    [30, 27],
  ])
    s.box(x, y, 6, 4, P.woodHi, P.wood, P.woodLo);
  s.rect(30, 27, 6, 1, P.blue);
  return s.finish();
}

function port(): Sprite {
  const s = new Sprite(FRAME, FRAME);
  // Jetty out over the water, planks running across.
  s.rect(4, 20, 33, 12, P.wood);
  for (let x = 4; x < 37; x += 3) s.rect(x, 20, 1, 12, P.woodLo);
  for (const x of [5, 13, 21, 29, 35]) s.px(x, 32, P.woodDk);
  // Warehouse with a slate roof, ridge east-west.
  s.rect(5, 6, 18, 6, P.slateHi);
  s.rect(5, 12, 18, 7, P.slate);
  s.rect(5, 12, 18, 1, P.slateLo);
  s.teamRect(5, 18, 18, 1, 128);
  // Crane: yellow cab and a jib over the water.
  s.box(27, 10, 6, 6, P.yellow, P.yellow, P.yellowLo);
  for (let k = 0; k < 2; k++)
    s.line(30 + k, 13, 23 + k, 33, k ? P.yellowLo : P.yellow);
  // Crates on the jetty.
  s.box(8, 23, 5, 5, P.stHi, P.st, P.stLo);
  s.box(14, 24, 5, 5, P.woodHi, P.wood, P.woodLo);
  return s.finish();
}

function hq(): Sprite {
  const s = new Sprite(FRAME, FRAME);
  // Yard inside a sandbag perimeter.
  s.rect(2, 3, 36, 34, hex("#b3b097"));
  sandbagWall(s, 1, 2, 38, 36);
  // L-shaped farmhouse with a slate roof and an owner-coloured ridge cap.
  s.rect(5, 6, 22, 5, P.slateHi);
  s.rect(5, 11, 22, 5, P.slate);
  s.rect(5, 15, 22, 1, P.slateLo);
  s.teamRect(5, 10, 22, 1, 150);
  s.rect(18, 16, 4, 14, P.slateHi);
  s.rect(22, 16, 5, 14, P.slate);
  s.rect(26, 11, 1, 19, P.slateLo);
  s.rect(18, 29, 9, 1, P.slateLo);
  s.teamRect(22, 11, 1, 19, 150);
  s.box(7, 7, 3, 3, P.brick, P.brick, P.ink);
  // Radio mast with guy wires.
  s.line(10, 26, 6, 21, P.ink);
  s.line(10, 26, 14, 21, P.ink);
  s.line(10, 26, 10, 33, P.ink);
  s.disc(10.5, 26.5, 1.6, P.stLo);
  // Supplies and the gate.
  s.box(29, 20, 5, 4, P.olive, P.olive, P.oliveLo);
  s.box(29, 25, 5, 4, P.woodHi, P.wood, P.woodLo);
  s.rect(29, 35, 7, 3, P.woodDk);
  flag(s, 34, 31);
  return s.finish();
}

function samLauncher(): Sprite {
  // Not used in horde mode (no SAMs); an empty frame keeps the badge.
  return new Sprite(FRAME, FRAME);
}

// ---------------------------------------------------------------------------
// One-cell buildings (CELL x CELL), drawn from rows of palette letters
// ---------------------------------------------------------------------------

const CELL_KEY: Record<string, RGB | null> = {
  ".": null,
  k: P.ink,
  W: P.woodHi,
  w: P.wood,
  d: P.woodLo,
  D: P.woodDk,
  S: hex("#b9b4a8"),
  s: hex("#9b968b"),
  z: hex("#6e6a62"),
  M: P.stHi,
  m: P.st,
  n: P.stLo,
  N: P.stDk,
  o: P.olive,
  O: P.oliveLo,
  r: P.red,
  R: P.redHi,
  g: hex("#c9ccd2"),
  G: hex("#8d939d"),
  y: P.yellow,
  e: P.earth,
};

const CELLS: Record<(typeof CELL_ORDER)[number], string[]> = {
  // Timber barricade: planks running along the wall, nail heads at the ends.
  wall1: [
    "DDDDDDDD",
    "WWWWWWWW",
    "wkwwwwkw",
    "dddddddd",
    "WWWWWWWW",
    "wkwwwwkw",
    "dddddddd",
    "DDDDDDDD",
  ],
  // Coursed stone blocks.
  wall2: [
    "SSSzSSSz",
    "ssszsssz",
    "zzzzzzzz",
    "SzSSSzSS",
    "szssszss",
    "zzzzzzzz",
    "SSSzSSSz",
    "zzzzzzzz",
  ],
  // Riveted steel plate.
  wall3: [
    "NNNNNNNN",
    "MMMNMMMN",
    "mNmNmNmN",
    "mmmNmmmN",
    "mmmNmmmN",
    "mNmNmNmN",
    "nnnNnnnN",
    "NNNNNNNN",
  ],
  mine: [
    "........",
    "..eeee..",
    ".eOoOoe.",
    ".eoRroe.",
    ".eorroe.",
    ".eOoOoe.",
    "..eeee..",
    "........",
  ],
  beacon: [
    ".gggggg.",
    ".gGGGGg.",
    "..gGGg..",
    "..gNNg..",
    "...nn...",
    "..k..k..",
    ".k.kk.k.",
    "k..k...k",
  ],
  beaconOn: [
    ".gggggg.",
    ".gRRRRg.",
    "..grrg..",
    "..gyyg..",
    "...nn...",
    "..k..k..",
    ".k.kk.k.",
    "k..k...k",
  ],
  depot: [
    "WwwW.oo.",
    "wDDw.oO.",
    "wDDw.OO.",
    "WwwW....",
    "....WwwW",
    ".oo.wDDw",
    ".oO.wDDw",
    ".OO.WwwW",
  ],
};

function cellSprite(rows: string[]): Sprite {
  const s = new Sprite(CELL, CELL);
  rows.forEach((row, y) => {
    if (row.length !== CELL)
      throw new Error(`cell row "${row}" is not ${CELL} wide`);
    [...row].forEach((ch, x) => {
      const c = CELL_KEY[ch];
      if (c === undefined) throw new Error(`unknown cell key "${ch}"`);
      if (c) s.px(x, y, c);
    });
  });
  return s;
}

// ---------------------------------------------------------------------------
// Atlases
// ---------------------------------------------------------------------------

const DRAW: Record<(typeof BUILDING_ORDER)[number], () => Sprite> = {
  City: city,
  Port: port,
  Factory: factory,
  "Defense Post": turret,
  "SAM Launcher": samLauncher,
  "Missile Silo": mortar,
  Outpost: outpost,
  HQ: hq,
};

export function buildAtlases(): {
  buildings: { w: number; h: number; rgba: Uint8Array };
  cells: { w: number; h: number; rgba: Uint8Array };
} {
  const bw = FRAME * BUILDING_ORDER.length;
  const bh = FRAME * 2;
  const b = new Uint8Array(bw * bh * 4);
  BUILDING_ORDER.forEach((name, col) => {
    const s = DRAW[name]();
    for (let y = 0; y < FRAME; y++)
      for (let x = 0; x < FRAME; x++) {
        const src = (y * FRAME + x) * 4;
        const dst = (y * bw + col * FRAME + x) * 4;
        b.set(s.rgba.subarray(src, src + 4), dst);
        const m = s.mask[y * FRAME + x];
        const mdst = ((y + FRAME) * bw + col * FRAME + x) * 4;
        if (m > 0) b.set([m, 0, 0, 255], mdst);
      }
  });
  const cw = CELL * CELL_ORDER.length;
  const c = new Uint8Array(cw * CELL * 4);
  CELL_ORDER.forEach((name, col) => {
    const s = cellSprite(CELLS[name]);
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        const src = (y * CELL + x) * 4;
        c.set(s.rgba.subarray(src, src + 4), (y * cw + col * CELL + x) * 4);
      }
  });
  return {
    buildings: { w: bw, h: bh, rgba: b },
    cells: { w: cw, h: CELL, rgba: c },
  };
}

const isMain = process.argv[1]?.endsWith("buildingSprites.ts");
if (isMain) {
  const { buildings, cells } = buildAtlases();
  const out = join(import.meta.dirname, "../../resources/atlases");
  writeFileSync(
    join(out, "building-sprites.png"),
    encodePng(buildings.w, buildings.h, buildings.rgba),
  );
  writeFileSync(
    join(out, "cell-sprites.png"),
    encodePng(cells.w, cells.h, cells.rgba),
  );
  console.log("wrote building-sprites.png and cell-sprites.png");
  const preview = process.argv[2];
  if (preview) {
    // An enlarged sheet on Daylight ground, owner colour lavender, to review.
    const k = 6;
    const pw = buildings.w * k;
    const ph = (FRAME + CELL * 3) * k;
    const img = new Uint8Array(pw * ph * 4);
    const ground = hex("#e2e6c4");
    const team: RGB = hex("#9da3ec");
    for (let i = 0; i < pw * ph; i++) img.set([...ground, 255], i * 4);
    const put = (x: number, y: number, c: RGB, a: number) => {
      for (let j = 0; j < k; j++)
        for (let i = 0; i < k; i++) {
          const o = ((y * k + j) * pw + x * k + i) * 4;
          for (let q = 0; q < 3; q++)
            img[o + q] = Math.round(
              img[o + q] * (1 - a / 255) + c[q] * (a / 255),
            );
        }
    };
    for (let y = 0; y < FRAME; y++)
      for (let x = 0; x < buildings.w; x++) {
        const o = (y * buildings.w + x) * 4;
        const a = buildings.rgba[o + 3];
        if (!a) continue;
        const mo = ((y + FRAME) * buildings.w + x) * 4;
        const m = buildings.rgba[mo + 3] ? buildings.rgba[mo] / 128 : 0;
        const c: RGB = m
          ? [
              Math.min(255, team[0] * m),
              Math.min(255, team[1] * m),
              Math.min(255, team[2] * m),
            ]
          : [buildings.rgba[o], buildings.rgba[o + 1], buildings.rgba[o + 2]];
        put(x, y, c, a);
      }
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < cells.w; x++) {
        const o = (y * cells.w + x) * 4;
        if (cells.rgba[o + 3])
          put(
            x + Math.floor(x / CELL) * CELL,
            FRAME + CELL + y,
            [cells.rgba[o], cells.rgba[o + 1], cells.rgba[o + 2]],
            255,
          );
      }
    mkdirSync(preview, { recursive: true });
    writeFileSync(join(preview, "sprites-preview.png"), encodePng(pw, ph, img));
    console.log("preview in", preview);
  }
}
