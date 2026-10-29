/**
 * Integer flow field for the zombie horde (zfront).
 *
 * Dial's algorithm (bucket-queue Dijkstra) over an 8-connected grid. `cost[i]`
 * is the terrain cost of cell i (1..MAX_CELL_COST), WALL_COST for a wall;
 * 0 means blocked. A step costs ORTHO_STEP or DIAG_STEP (about 1 : sqrt 2)
 * times the cost of the cell it leaves, and a diagonal step may not cut the
 * corner between two cells when either of them is blocked or a wall. Sources
 * start at distance 0 whatever their own cost, so a structure cell can be
 * both an obstacle and a target. Every value is an integer, so the field is
 * identical on every client.
 *
 * Walls are expensive rather than blocked: the flow goes around a wall when
 * there is a way round, and through it (so the horde presses on it) when the
 * base is sealed.
 */

export const UNREACHABLE = 0xffffffff;
/** Highest terrain cost. */
export const MAX_CELL_COST = 15;
/** Cost of a wall cell: one wall is worth a long detour. */
export const WALL_COST = 255;
export const ORTHO_STEP = 5;
export const DIAG_STEP = 7;
const NUM_BUCKETS = DIAG_STEP * WALL_COST + 1;
/** Highest start distance for a source: one bucket ring ahead. */
export const MAX_START = NUM_BUCKETS - 1;

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
      this.buckets.push(new Int32Array(16));
    }
  }

  /**
   * Recomputes every cell's distance to the nearest source. Each source
   * starts at its entry in `starts` (default 0), below MAX_START: a source
   * that starts lower draws the flow from further away, as bait does.
   */
  compute(sources: ArrayLike<number>, starts?: ArrayLike<number>): void {
    const w = this.width;
    const h = this.height;
    const dist = this.dist;
    const cost = this.cost;
    dist.fill(UNREACHABLE);
    this.sizes.fill(0);

    let pending = 0;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      const d = Math.min(MAX_START, starts?.[k] ?? 0);
      if (dist[s] <= d) continue;
      dist[s] = d;
      this.push(d % NUM_BUCKETS, s);
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
        const cW = hasW ? cost[i - 1] : 0;
        const cE = hasE ? cost[i + 1] : 0;
        const cN = hasN ? cost[i - w] : 0;
        const cS = hasS ? cost[i + w] : 0;
        if (cW !== 0) pending += this.relax(i - 1, cur, ORTHO_STEP);
        if (cE !== 0) pending += this.relax(i + 1, cur, ORTHO_STEP);
        if (cN !== 0) pending += this.relax(i - w, cur, ORTHO_STEP);
        if (cS !== 0) pending += this.relax(i + w, cur, ORTHO_STEP);
        const clearW = cW !== 0 && cW !== WALL_COST;
        const clearE = cE !== 0 && cE !== WALL_COST;
        const clearN = cN !== 0 && cN !== WALL_COST;
        const clearS = cS !== 0 && cS !== WALL_COST;
        if (clearN && clearW) pending += this.relax(i - w - 1, cur, DIAG_STEP);
        if (clearN && clearE) pending += this.relax(i - w + 1, cur, DIAG_STEP);
        if (clearS && clearW) pending += this.relax(i + w - 1, cur, DIAG_STEP);
        if (clearS && clearE) pending += this.relax(i + w + 1, cur, DIAG_STEP);
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
 * that would cut a blocked or walled corner are left out, matching FlowField.
 */
export function neighbours8(
  cost: Uint8Array,
  width: number,
  height: number,
  i: number,
  out: Int32Array,
): number {
  const x = i % width;
  const cN = i >= width ? cost[i - width] : 0;
  const cE = x < width - 1 ? cost[i + 1] : 0;
  const cS = i < width * (height - 1) ? cost[i + width] : 0;
  const cW = x > 0 ? cost[i - 1] : 0;
  let n = 0;
  if (cN !== 0) out[n++] = i - width;
  if (cE !== 0) out[n++] = i + 1;
  if (cS !== 0) out[n++] = i + width;
  if (cW !== 0) out[n++] = i - 1;
  const clearN = cN !== 0 && cN !== WALL_COST;
  const clearE = cE !== 0 && cE !== WALL_COST;
  const clearS = cS !== 0 && cS !== WALL_COST;
  const clearW = cW !== 0 && cW !== WALL_COST;
  if (clearN && clearE) out[n++] = i - width + 1;
  if (clearS && clearE) out[n++] = i + width + 1;
  if (clearS && clearW) out[n++] = i + width - 1;
  if (clearN && clearW) out[n++] = i - width - 1;
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
