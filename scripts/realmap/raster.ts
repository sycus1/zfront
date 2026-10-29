// Scanline drawing onto a width x height grid of tiles. Coordinates are in
// tiles with (0, 0) at the top-left corner of the first tile, so the centre
// of tile (x, y) is (x + 0.5, y + 0.5). A tile is painted when its centre
// lies inside the shape.

export type Point = [number, number];
export type Paint = (x: number, y: number) => void;

/** Fills a polygon given as rings (outer and holes), even-odd rule. */
export function fillPolygon(
  rings: Point[][],
  width: number,
  height: number,
  paint: Paint,
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [, y] of ring) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(height - 1, Math.floor(maxY - 0.5));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j];
        const [bx, by] = ring[i];
        if (ay <= cy === by <= cy) continue;
        xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) paint(x, y);
    }
  }
}

/**
 * Strokes a polyline `widthTiles` wide: paints every tile whose centre is
 * within half the width of a segment (at least half a tile).
 */
export function strokeLine(
  line: Point[],
  widthTiles: number,
  width: number,
  height: number,
  paint: Paint,
): void {
  const r = Math.max(widthTiles, 1) / 2;
  const r2 = r * r;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        const t =
          len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        if (ex * ex + ey * ey <= r2) paint(x, y);
      }
    }
  }
}
