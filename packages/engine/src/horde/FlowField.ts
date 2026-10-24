/**
 * Integer flow field for the zombie horde (zfront).
 *
 * Dial's algorithm (bucket-queue Dijkstra) over a 4-connected grid. `cost[i]`
 * is the cost of stepping INTO cell i (1..MAX_CELL_COST); 0 means blocked.
 * Sources start at distance 0 whatever their own cost, so a structure cell can
 * be both an obstacle and a target. Every value is an integer, so the field is
 * identical on every client.
 */

export const UNREACHABLE = 0xffffffff;
export const MAX_CELL_COST = 15;
const NUM_BUCKETS = MAX_CELL_COST + 1;

export class FlowField {
  readonly dist: Uint32Array;
  private readonly buckets: Int32Array[] = [];
  private readonly sizes = new Int32Array(NUM_BUCKETS);

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly cost: Uint8Array,
  ) {
    if (cost.length !== width * height) {
      throw new Error("cost field size does not match the grid");
    }
    this.dist = new Uint32Array(width * height).fill(UNREACHABLE);
    for (let b = 0; b < NUM_BUCKETS; b++) {
      this.buckets.push(new Int32Array(1024));
    }
  }

  /** Recomputes every cell's distance to the nearest source. */
  compute(sources: ArrayLike<number>): void {
    const w = this.width;
    const h = this.height;
    const dist = this.dist;
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

    // A pushed distance is at most cur + MAX_CELL_COST, so the bucket being
    // drained only ever holds entries for `cur` (stale ones are skipped).
    for (let cur = 0; pending > 0; cur++) {
      const b = cur % NUM_BUCKETS;
      const bucket = this.buckets[b];
      while (this.sizes[b] > 0) {
        const i = bucket[--this.sizes[b]];
        pending--;
        if (dist[i] !== cur) continue;
        const x = i % w;
        if (x > 0) pending += this.relax(i - 1, cur);
        if (x < w - 1) pending += this.relax(i + 1, cur);
        if (i >= w) pending += this.relax(i - w, cur);
        if (i < w * (h - 1)) pending += this.relax(i + w, cur);
      }
    }
  }

  private relax(n: number, base: number): number {
    const c = this.cost[n];
    if (c === 0) return 0;
    const nd = base + c;
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
 * The 4-neighbour of cell `i` with the strictly lowest distance, or -1 when
 * no neighbour is closer to a target. Ties go to the first in N, E, S, W
 * order, which keeps movement deterministic.
 */
export function downhill(
  dist: Uint32Array,
  width: number,
  height: number,
  i: number,
): number {
  let best = -1;
  let bestD = dist[i];
  const x = i % width;
  if (i >= width && dist[i - width] < bestD) {
    best = i - width;
    bestD = dist[best];
  }
  if (x < width - 1 && dist[i + 1] < bestD) {
    best = i + 1;
    bestD = dist[best];
  }
  if (i < width * (height - 1) && dist[i + width] < bestD) {
    best = i + width;
    bestD = dist[best];
  }
  if (x > 0 && dist[i - 1] < bestD) {
    best = i - 1;
  }
  return best;
}
