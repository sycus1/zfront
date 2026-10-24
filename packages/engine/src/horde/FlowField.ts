/**
 * Integer flow field for the zombie horde (zfront).
 *
 * Dial's algorithm (bucket-queue Dijkstra) over an 8-connected grid. `cost[i]`
 * is the terrain cost of cell i (1..MAX_CELL_COST); 0 means blocked. A step
 * costs ORTHO_STEP or DIAG_STEP (about 1 : sqrt 2) times the cost of the cell
 * it leaves, and a diagonal step may not cut the corner between two cells
 * when either of them is blocked. Sources start at distance 0 whatever their
 * own cost, so a structure cell can be both an obstacle and a target. Every
 * value is an integer, so the field is identical on every client.
 */

export const UNREACHABLE = 0xffffffff;
export const MAX_CELL_COST = 15;
export const ORTHO_STEP = 5;
export const DIAG_STEP = 7;
const NUM_BUCKETS = DIAG_STEP * MAX_CELL_COST + 1;

export class FlowField {
  readonly dist: Uint32Array;
  private readonly buckets: Int32Array[] = [];
  private readonly sizes = new Int32Array(NUM_BUCKETS);

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cost: Uint8Array,
  ) {
    if (cost.length !== width * height) {
      throw new Error("cost field size does not match the grid");
    }
    this.dist = new Uint32Array(width * height).fill(UNREACHABLE);
    for (let b = 0; b < NUM_BUCKETS; b++) {
      this.buckets.push(new Int32Array(256));
    }
  }

  /** Recomputes every cell's distance to the nearest source. */
  compute(sources: ArrayLike<number>): void {
    const w = this.width;
    const h = this.height;
    const dist = this.dist;
    const cost = this.cost;
    dist.fill(UNREACHABLE);
    this.sizes.fill(0);

    let pending = 0;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      if (dist[s] === 0) continue;
      dist[s] = 0;
      this.push(0, s);
      pending++;
    }

    // A pushed distance is at most cur + DIAG_STEP * MAX_CELL_COST, so the
    // bucket being drained only ever holds entries for `cur` (stale ones are
    // skipped).
    for (let cur = 0; pending > 0; cur++) {
      const b = cur % NUM_BUCKETS;
      const bucket = this.buckets[b];
      while (this.sizes[b] > 0) {
        const i = bucket[--this.sizes[b]];
        pending--;
        if (dist[i] !== cur) continue;
        const x = i % w;
        const hasW = x > 0;
        const hasE = x < w - 1;
        const hasN = i >= w;
        const hasS = i < w * (h - 1);
        const openW = hasW && cost[i - 1] !== 0;
        const openE = hasE && cost[i + 1] !== 0;
        const openN = hasN && cost[i - w] !== 0;
        const openS = hasS && cost[i + w] !== 0;
        if (openW) pending += this.relax(i - 1, cur, ORTHO_STEP);
        if (openE) pending += this.relax(i + 1, cur, ORTHO_STEP);
        if (openN) pending += this.relax(i - w, cur, ORTHO_STEP);
        if (openS) pending += this.relax(i + w, cur, ORTHO_STEP);
        if (openN && openW) pending += this.relax(i - w - 1, cur, DIAG_STEP);
        if (openN && openE) pending += this.relax(i - w + 1, cur, DIAG_STEP);
        if (openS && openW) pending += this.relax(i + w - 1, cur, DIAG_STEP);
        if (openS && openE) pending += this.relax(i + w + 1, cur, DIAG_STEP);
      }
    }
  }

  private relax(n: number, base: number, step: number): number {
    const c = this.cost[n];
    if (c === 0) return 0;
    const nd = base + step * c;
    if (nd >= this.dist[n]) return 0;
    this.dist[n] = nd;
    this.push(nd % NUM_BUCKETS, n);
    return 1;
  }

  private push(b: number, cell: number): void {
    let bucket = this.buckets[b];
    const size = this.sizes[b];
    if (size === bucket.length) {
      const grown = new Int32Array(bucket.length * 2);
      grown.set(bucket);
      this.buckets[b] = bucket = grown;
    }
    bucket[size] = cell;
    this.sizes[b] = size + 1;
  }
}

/**
 * Writes the reachable 8-neighbours of cell `i` into `out` in a fixed order
 * (N, E, S, W, NE, SE, SW, NW) and returns how many there are. Diagonals
 * that would cut a blocked corner are left out, matching FlowField.
 */
export function neighbours8(
  cost: Uint8Array,
  width: number,
  height: number,
  i: number,
  out: Int32Array,
): number {
  const x = i % width;
  const openN = i >= width && cost[i - width] !== 0;
  const openE = x < width - 1 && cost[i + 1] !== 0;
  const openS = i < width * (height - 1) && cost[i + width] !== 0;
  const openW = x > 0 && cost[i - 1] !== 0;
  let n = 0;
  if (openN) out[n++] = i - width;
  if (openE) out[n++] = i + 1;
  if (openS) out[n++] = i + width;
  if (openW) out[n++] = i - 1;
  if (openN && openE) out[n++] = i - width + 1;
  if (openS && openE) out[n++] = i + width + 1;
  if (openS && openW) out[n++] = i + width - 1;
  if (openN && openW) out[n++] = i - width - 1;
  return n;
}

/**
 * The neighbour of cell `i` with the strictly lowest distance, or -1 when no
 * neighbour is closer to a target. Ties go to the first in neighbours8
 * order, which keeps movement deterministic.
 */
export function downhill(
  dist: Uint32Array,
  cost: Uint8Array,
  width: number,
  height: number,
  i: number,
  scratch: Int32Array,
): number {
  const n = neighbours8(cost, width, height, i, scratch);
  let best = -1;
  let bestD = dist[i];
  for (let k = 0; k < n; k++) {
    const c = scratch[k];
    if (dist[c] < bestD) {
      best = c;
      bestD = dist[c];
    }
  }
  return best;
}
