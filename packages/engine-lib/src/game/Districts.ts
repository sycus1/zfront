/**
 * zfront: the map cut into districts, the ground a player takes and holds
 * as a buffer round their base (see horde/Districts.ts in the engine).
 *
 * Districts are cells of a jittered grid over the coarse (map4x) cells:
 * one seed per `size` x `size` block, nudged by a fixed hash so the shapes
 * aren't squares, and each coarse cell belongs to its nearest seed. The
 * engine and the renderer both build the same map from the grid size and
 * `size`, so the frame only has to carry each district's state.
 *
 * Deterministic: integers only, no PRNG.
 */

export interface DistrictMap {
  /** District size in coarse cells; 0 means districts are off. */
  size: number;
  /** Districts across and down. */
  cols: number;
  rows: number;
  /** cols x rows. */
  count: number;
  /** The district of each coarse cell (row-major, width x height). */
  ids: Uint16Array;
  /** Neighbouring districts of each district, in id order. */
  neighbours: number[][];
}

/** A small integer hash, the same on every client. */
function mix(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Builds the districts for a `width` x `height` coarse grid with seeds about
 * `size` cells apart. `size` 0 (or less) gives one district covering it all.
 */
export function buildDistricts(
  width: number,
  height: number,
  size: number,
): DistrictMap {
  const ids = new Uint16Array(width * height);
  if (size <= 0 || width <= 0 || height <= 0) {
    return { size: 0, cols: 1, rows: 1, count: 1, ids, neighbours: [[]] };
  }
  const cols = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));
  const count = cols * rows;
  // Seeds sit within the middle two thirds of their block.
  const span = Math.max(1, Math.floor((size * 2) / 3));
  const margin = Math.floor((size - span) / 2);
  const sx = new Int32Array(count);
  const sy = new Int32Array(count);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = j * cols + i;
      const x0 = i * size;
      const y0 = j * size;
      const bw = Math.min(size, width - x0);
      const bh = Math.min(size, height - y0);
      sx[d] = x0 + Math.min(bw - 1, margin + (mix(i, j, 1) % span));
      sy[d] = y0 + Math.min(bh - 1, margin + (mix(i, j, 2) % span));
    }
  }
  for (let y = 0; y < height; y++) {
    const bj = Math.min(rows - 1, Math.floor(y / size));
    for (let x = 0; x < width; x++) {
      const bi = Math.min(cols - 1, Math.floor(x / size));
      let best = -1;
      let bestD = 0;
      for (let j = bj - 1; j <= bj + 1; j++) {
        if (j < 0 || j >= rows) continue;
        for (let i = bi - 1; i <= bi + 1; i++) {
          if (i < 0 || i >= cols) continue;
          const d = j * cols + i;
          const dx = x - sx[d];
          const dy = y - sy[d];
          const d2 = dx * dx + dy * dy;
          if (best < 0 || d2 < bestD) {
            best = d;
            bestD = d2;
          }
        }
      }
      ids[y * width + x] = best;
    }
  }
  const sets: Set<number>[] = [];
  for (let d = 0; d < count; d++) sets.push(new Set());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = ids[y * width + x];
      if (x + 1 < width) {
        const b = ids[y * width + x + 1];
        if (a !== b) {
          sets[a].add(b);
          sets[b].add(a);
        }
      }
      if (y + 1 < height) {
        const b = ids[(y + 1) * width + x];
        if (a !== b) {
          sets[a].add(b);
          sets[b].add(a);
        }
      }
    }
  }
  const neighbours = sets.map((s) => [...s].sort((a, b) => a - b));
  return { size, cols, rows, count, ids, neighbours };
}

/** A district's state, one byte each in HordeFrame.districts. */
export const DistrictState = {
  /** Nobody holds it; waves may rise here. */
  Wild: 0,
  /** An Outpost stands in it but it isn't cleared yet. */
  Securing: 1,
  /** Held as a buffer: no wave rises here. */
  Held: 2,
  /** Held, but enough of the horde is in it that it's being overrun. */
  Threatened: 3,
  /** Settled land round a base: held, and never overrun. */
  Core: 4,
} as const;
