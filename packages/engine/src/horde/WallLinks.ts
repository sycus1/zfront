/**
 * Wall links (zfront): a new wall post joins nearby posts and mountains
 * with solid spans, on the horde's coarse grid (one cell is 2x2 tiles).
 *
 * The post takes the nearest candidate within the snap radius, then the
 * nearest one on roughly the opposite side (at least 135 degrees away), so
 * a post dropped into a gap closes it on both sides while one added at the
 * end of a line only joins the line. A candidate counts only when every
 * cell on the straight line to it can carry a span or is mountain already.
 *
 * Spans are 8-connected lines. The flow field never lets the horde cut a
 * corner past a wall cell, so a diagonal span has no gaps. Integers only.
 */

import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";

/**
 * The build grid: horde buildings snap to the top-left tile of their 2x2
 * cell, so each fills exactly one coarse cell.
 */
export function snapToCell(map: GameMap, tile: TileRef): TileRef {
  return map.ref(map.x(tile) & ~1, map.y(tile) & ~1);
}

/** A post a new one may join: its coarse cell and unit id. */
export interface LinkPost {
  cell: number;
  id: number;
}

export interface WallLink {
  /** Unit id of the post at the far end, or -1 for a mountain. */
  post: number;
  /** The far end's cell. */
  anchor: number;
  /** Cells the span fills, in order from the new post; mountain is left out. */
  cells: number[];
}

export interface LinkGrid {
  readonly width: number;
  readonly height: number;
  /** Ground the horde can't cross on its own: an anchor, and free to span over. */
  isMountain(cell: number): boolean;
  /** Whether a span may fill this (non-mountain) cell. */
  spannable(cell: number): boolean;
}

/** Most links a new post makes. */
export const MAX_LINKS = 2;

/** Cells strictly between `from` and `to` on an 8-connected line. */
export function lineCells(from: number, to: number, width: number): number[] {
  let x = from % width;
  let y = (from - x) / width;
  const x1 = to % width;
  const y1 = (to - x1) / width;
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  const cells: number[] = [];
  for (;;) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) return cells;
    cells.push(y * width + x);
  }
}

interface Candidate {
  cell: number;
  post: number;
  dx: number;
  dy: number;
  d2: number;
}

/**
 * The links a post at `cell` makes, nearest first. `posts` are the owner's
 * other posts; mountain cells within `radius` are candidates too.
 */
export function chooseLinks(
  cell: number,
  posts: readonly LinkPost[],
  grid: LinkGrid,
  radius: number,
): WallLink[] {
  if (radius <= 0) return [];
  const w = grid.width;
  const cx = cell % w;
  const cy = (cell - cx) / w;
  const r2 = radius * radius;
  const candidates: Candidate[] = [];
  for (const p of posts) {
    const px = p.cell % w;
    const dx = px - cx;
    const dy = (p.cell - px) / w - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0 && d2 <= r2) {
      candidates.push({ cell: p.cell, post: p.id, dx, dy, d2 });
    }
  }
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= grid.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const d2 = dx * dx + dy * dy;
      if (x < 0 || x >= w || d2 === 0 || d2 > r2) continue;
      const c = y * w + x;
      if (grid.isMountain(c))
        candidates.push({ cell: c, post: -1, dx, dy, d2 });
    }
  }
  // Nearest first; posts before mountains at the same distance.
  candidates.sort(
    (a, b) =>
      a.d2 - b.d2 || Number(a.post < 0) - Number(b.post < 0) || a.cell - b.cell,
  );

  const links: WallLink[] = [];
  let first: Candidate | null = null;
  const taken = new Set<number>();
  for (const c of candidates) {
    if (first !== null) {
      // Roughly opposite the first link: cos(angle) <= -1/sqrt(2).
      const dot = c.dx * first.dx + c.dy * first.dy;
      if (dot > 0 || 2 * dot * dot < c.d2 * first.d2) continue;
    }
    const cells = spanCells(cell, c.cell, grid, taken);
    if (cells === null) continue;
    links.push({ post: c.post, anchor: c.cell, cells });
    for (const s of cells) taken.add(s);
    first ??= c;
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

/** The span's cells, or null when the line can't carry one. */
function spanCells(
  from: number,
  to: number,
  grid: LinkGrid,
  taken: ReadonlySet<number>,
): number[] | null {
  const cells: number[] = [];
  for (const c of lineCells(from, to, grid.width)) {
    if (grid.isMountain(c)) continue;
    if (taken.has(c) || !grid.spannable(c)) return null;
    cells.push(c);
  }
  return cells;
}
