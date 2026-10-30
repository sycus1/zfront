/**
 * HordeSwarm — the zfront horde drawn as one square per zombie.
 *
 * The engine keeps the horde as a zombie count per coarse cell (2x2 tiles)
 * and sends it to the client each tick. This is a purely visual model on
 * top: a pool of particles, one per zombie, each assigned to a cell. When
 * the counts change, particles walk from cells that have too many into
 * neighbouring cells that need more, the rest die where they stand, and new
 * ones appear where a cell still needs more (fresh zombies coming ashore).
 * So a stream of zombies reads as squares walking along it.
 *
 * Cells are drawn exactly up to `SWARM_CELL_CAP` zombies. A packed cell
 * gets that many squares and the horde pass draws a dark blob under it. If
 * the whole horde would need more than `SWARM_MAX_PARTICLES`, the cap per
 * cell is lowered for that frame.
 *
 * Positions are in tiles. Nothing here feeds back into the simulation.
 */

import { hordeDensityCount } from "@openfront/engine-lib/game/HordeCells";

/** Squares drawn per cell at most; a cell is 2x2 tiles. */
export const SWARM_CELL_CAP = 32;
/** Squares alive at once at most. */
export const SWARM_MAX_PARTICLES = 40_000;
/** Seconds a killed zombie stays on screen as a fading mark. */
export const SWARM_DEATH_SEC = 0.6;
/** Killed zombies kept on screen at most; older marks go first. */
export const SWARM_MAX_DYING = 8_000;
/** Floats per instance: from x, y, to x, y, seed, born at, died at. */
export const SWARM_FLOATS = 7;

/** Cell bytes from here up are buildings, walls and elites, not density. */
const FIRST_NON_DENSITY_BYTE = 248;
/** Keeps squares inside their own cell (tiles from the cell's corner). */
const INSET = 0.2;
/** Share of the squares that stay in their cell but shuffle within it. */
const SHUFFLE = 0.15;
/** Cells a square may walk in one move to fill a cell that needs it. */
const REACH = 4;
const DEFAULT_MOVE_SEC = 0.3;
const MIN_MOVE_SEC = 0.05;
const MAX_MOVE_SEC = 0.6;

export class HordeSwarm {
  /** Squares alive now. */
  count = 0;
  /** Killed squares still fading out. */
  dyingCount = 0;
  /** When the current move started and how long it takes, in seconds. */
  moveStart = 0;
  moveSec = DEFAULT_MOVE_SEC;
  /** Squares per cell at most on the last frame (see `cellCap`). */
  cap = SWARM_CELL_CAP;

  private fromX = new Float32Array(0);
  private fromY = new Float32Array(0);
  private toX = new Float32Array(0);
  private toY = new Float32Array(0);
  private seed = new Float32Array(0);
  private born = new Float32Array(0);
  private cell = new Int32Array(0);

  private deadX = new Float32Array(SWARM_MAX_DYING);
  private deadY = new Float32Array(SWARM_MAX_DYING);
  private deadSeed = new Float32Array(SWARM_MAX_DYING);
  private deadAt = new Float32Array(SWARM_MAX_DYING);

  private w = 0;
  private h = 0;
  private prev: Uint8Array | null = null;
  private lastChange = -1;
  // Per-cell scratch.
  private need = new Int32Array(0);
  private start = new Int32Array(0);
  private hi = new Int32Array(0);
  private active = new Int32Array(0);
  private occupied = new Int32Array(0);
  private order = new Int32Array(0);
  private kill = new Uint8Array(0);
  private rng = 0x9e3779b9;

  constructor(seed = 1) {
    this.rng = seed >>> 0 || 1;
  }

  /** The cell each live square is in (for tests). */
  cellOf(i: number): number {
    return this.cell[i];
  }

  /**
   * Takes a new frame of cell bytes at time `now` (seconds). Returns false
   * when the cells are unchanged, so there is nothing new to upload.
   */
  update(cells: Uint8Array, w: number, h: number, now: number): boolean {
    if (w !== this.w || h !== this.h) this.reset(w, h);
    const n = w * h;
    const prev = this.prev!;
    // The one pass over the whole grid: spot a change and list the cells
    // with zombies. Everything after only looks at listed cells.
    const active = this.active;
    let numActive = 0;
    let changed = this.lastChange < 0;
    for (let c = 0; c < n; c++) {
      const b = cells[c];
      if (b !== prev[c]) {
        prev[c] = b;
        changed = true;
      }
      if (b > 0 && b < FIRST_NON_DENSITY_BYTE) active[numActive++] = c;
    }
    if (!changed) return false;

    // Pace the walk to how often the horde actually steps.
    if (this.lastChange >= 0) {
      const gap = now - this.lastChange;
      const sec = Math.min(MAX_MOVE_SEC, Math.max(MIN_MOVE_SEC, gap));
      this.moveSec += (sec - this.moveSec) * 0.3;
    }
    this.settle(now);
    this.lastChange = now;
    this.moveStart = now;

    // `need` is 0 outside the listed cells between updates.
    const need = this.need;
    const cap = (this.cap = this.cellCap(cells, numActive));
    for (let a = 0; a < numActive; a++) {
      const c = active[a];
      need[c] = Math.min(cap, hordeDensityCount(cells[c]));
    }

    // Group the squares by cell: `order[start[c], hi[c])` are cell c's.
    const start = this.start;
    const hi = this.hi;
    const occupied = this.occupied;
    let numOccupied = 0;
    for (let i = 0; i < this.count; i++) {
      const c = this.cell[i];
      if (hi[c]++ === 0) occupied[numOccupied++] = c;
    }
    let offset = 0;
    for (let a = 0; a < numOccupied; a++) {
      const c = occupied[a];
      need[c] -= hi[c];
      start[c] = offset;
      offset += hi[c];
      hi[c] = start[c];
    }
    const order = this.order;
    for (let i = 0; i < this.count; i++) order[hi[this.cell[i]]++] = i;

    // Walk the surplus into nearby cells that need squares, nearest first
    // across the whole horde, so a blob moving on keeps its squares; kill
    // the rest.
    const surplus: number[] = [];
    for (let a = 0; a < numOccupied; a++) {
      if (need[occupied[a]] < 0) surplus.push(occupied[a]);
    }
    this.kill.fill(0, 0, this.count);
    for (let r = 1; r <= REACH; r++) {
      for (const c of surplus) {
        while (need[c] < 0) {
          const to = this.neediestWithin(c, r);
          if (to < 0) break;
          const k = this.nearestSquare(start[c], hi[c], to);
          const i = order[k];
          order[k] = order[--hi[c]];
          need[c]++;
          need[to]--;
          this.cell[i] = to;
          this.pickSpot(i, to);
        }
      }
    }
    for (const c of surplus) {
      for (; need[c] < 0; need[c]++) this.kill[order[--hi[c]]] = 1;
    }
    // Some of those that stay shuffle about their cell.
    for (let a = 0; a < numOccupied; a++) {
      const c = occupied[a];
      for (let k = start[c]; k < hi[c]; k++) {
        if (this.random() < SHUFFLE) this.pickSpot(order[k], c);
      }
      hi[c] = 0;
      need[c] = 0;
    }
    this.removeKilled(now);

    // New zombies appear where cells still need squares.
    for (let a = 0; a < numActive; a++) {
      const c = active[a];
      for (let k = need[c]; k > 0 && this.count < SWARM_MAX_PARTICLES; k--) {
        this.spawn(c, now);
      }
      need[c] = 0;
    }
    return true;
  }

  /**
   * Writes every square, live ones then fading ones, as `SWARM_FLOATS`
   * floats each. Returns the number written; `out` must hold them all.
   */
  writeInstances(out: Float32Array, now: number): number {
    let o = 0;
    for (let i = 0; i < this.count; i++) {
      out[o++] = this.fromX[i];
      out[o++] = this.fromY[i];
      out[o++] = this.toX[i];
      out[o++] = this.toY[i];
      out[o++] = this.seed[i];
      out[o++] = this.born[i];
      out[o++] = -1;
    }
    let dying = 0;
    for (let k = 0; k < this.dyingCount; k++) {
      if (now - this.deadAt[k] >= SWARM_DEATH_SEC) continue;
      out[o++] = this.deadX[k];
      out[o++] = this.deadY[k];
      out[o++] = this.deadX[k];
      out[o++] = this.deadY[k];
      out[o++] = this.deadSeed[k];
      out[o++] = this.deadAt[k];
      out[o++] = this.deadAt[k];
      dying++;
    }
    return this.count + dying;
  }

  /** Squares `writeInstances` may write at most. */
  maxInstances(): number {
    return this.count + this.dyingCount;
  }

  private reset(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.prev = new Uint8Array(n);
    this.need = new Int32Array(n);
    this.start = new Int32Array(n);
    this.hi = new Int32Array(n);
    this.active = new Int32Array(n);
    this.occupied = new Int32Array(n);
    this.count = 0;
    this.dyingCount = 0;
    this.lastChange = -1;
  }

  /**
   * The cap per cell: `SWARM_CELL_CAP`, lowered until the whole horde fits
   * in `SWARM_MAX_PARTICLES`.
   */
  private cellCap(cells: Uint8Array, numActive: number): number {
    let cap = SWARM_CELL_CAP;
    for (;;) {
      let total = 0;
      for (let a = 0; a < numActive; a++) {
        total += Math.min(cap, hordeDensityCount(cells[this.active[a]]));
      }
      if (total <= SWARM_MAX_PARTICLES || cap === 1) return cap;
      cap = Math.max(1, Math.floor((cap * SWARM_MAX_PARTICLES) / total));
    }
  }

  /** Freezes every square where the last move has got it to. */
  private settle(now: number): void {
    const t = Math.min(1, Math.max(0, (now - this.moveStart) / this.moveSec));
    for (let i = 0; i < this.count; i++) {
      this.fromX[i] += (this.toX[i] - this.fromX[i]) * t;
      this.fromY[i] += (this.toY[i] - this.fromY[i]) * t;
      this.toX[i] = this.fromX[i];
      this.toY[i] = this.fromY[i];
    }
  }

  /**
   * The cell within `reach` cells of `c` that needs the most, nearest ring
   * first, or -1.
   */
  private neediestWithin(c: number, reach: number): number {
    const w = this.w;
    const x = c % w;
    const y = (c - x) / w;
    for (let r = 1; r <= reach; r++) {
      let best = -1;
      let most = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= this.h) continue;
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const nc = ny * w + nx;
          if (this.need[nc] > most) {
            most = this.need[nc];
            best = nc;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** The slot in `order[lo, hi)` of the square nearest cell `to`. */
  private nearestSquare(lo: number, hi: number, to: number): number {
    const cx = (to % this.w) * 2 + 1;
    const cy = Math.floor(to / this.w) * 2 + 1;
    let best = lo;
    let bestD = Infinity;
    for (let k = lo; k < hi; k++) {
      const i = this.order[k];
      const dx = this.toX[i] - cx;
      const dy = this.toY[i] - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  /** Sends square `i` to a random spot in cell `c`. */
  private pickSpot(i: number, c: number): void {
    const x = c % this.w;
    const y = (c - x) / this.w;
    const span = 2 - 2 * INSET;
    this.toX[i] = x * 2 + INSET + this.random() * span;
    this.toY[i] = y * 2 + INSET + this.random() * span;
  }

  private spawn(c: number, now: number): void {
    this.grow(this.count + 1);
    const i = this.count++;
    this.cell[i] = c;
    this.pickSpot(i, c);
    this.fromX[i] = this.toX[i];
    this.fromY[i] = this.toY[i];
    this.seed[i] = this.random();
    this.born[i] = now;
  }

  /** Drops killed squares, leaving a fading mark where each one fell. */
  private removeKilled(now: number): void {
    // Forget marks that have faded.
    let keep = 0;
    for (let k = 0; k < this.dyingCount; k++) {
      if (now - this.deadAt[k] >= SWARM_DEATH_SEC) continue;
      this.deadX[keep] = this.deadX[k];
      this.deadY[keep] = this.deadY[k];
      this.deadSeed[keep] = this.deadSeed[k];
      this.deadAt[keep] = this.deadAt[k];
      keep++;
    }
    this.dyingCount = keep;

    let j = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.kill[i]) {
        if (this.dyingCount < SWARM_MAX_DYING) {
          const k = this.dyingCount++;
          this.deadX[k] = this.fromX[i];
          this.deadY[k] = this.fromY[i];
          this.deadSeed[k] = this.seed[i];
          this.deadAt[k] = now;
        }
        continue;
      }
      if (j !== i) {
        this.fromX[j] = this.fromX[i];
        this.fromY[j] = this.fromY[i];
        this.toX[j] = this.toX[i];
        this.toY[j] = this.toY[i];
        this.seed[j] = this.seed[i];
        this.born[j] = this.born[i];
        this.cell[j] = this.cell[i];
      }
      j++;
    }
    this.count = j;
  }

  private grow(needed: number): void {
    if (needed <= this.cell.length) return;
    const size = Math.max(1024, this.cell.length * 2, needed);
    this.fromX = resized(this.fromX, size);
    this.fromY = resized(this.fromY, size);
    this.toX = resized(this.toX, size);
    this.toY = resized(this.toY, size);
    this.seed = resized(this.seed, size);
    this.born = resized(this.born, size);
    const cell = new Int32Array(size);
    cell.set(this.cell);
    this.cell = cell;
    this.order = new Int32Array(size);
    this.kill = new Uint8Array(size);
  }

  /** xorshift32 in [0, 1); visual only, so no need for the engine PRNG. */
  private random(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }
}

function resized(a: Float32Array, size: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(size);
  out.set(a);
  return out;
}
