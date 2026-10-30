import { GameMap } from "@openfront/engine-api/game/GameMap";
import { hordeMoveCost } from "@openfront/engine-lib/game/HordeTerrain";
import { MAX_CELL_COST, neighbours8, UNREACHABLE } from "./FlowField";

/**
 * The mass horde as a density field (zfront): zombies per cell of the coarse
 * (map4x) grid, flowing downhill along a FlowField each tick. Cost does not
 * depend on horde size, only on map size. Integers only.
 */

export const DEFAULT_CELL_CAP = 2000;

/**
 * Movement cost per coarse cell from the terrain (see `hordeMoveCost`):
 * 0 (blocked) for water, impassable and mountain at or above
 * `blockedMagnitude`, otherwise slower on higher ground.
 */
export function buildCostField(
  map: GameMap,
  blockedMagnitude: number,
): Uint8Array {
  const w = map.width();
  const h = map.height();
  const cost = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = hordeMoveCost(map.terrainByte(map.ref(x, y)), blockedMagnitude);
      cost[y * w + x] = Math.min(MAX_CELL_COST, c);
    }
  }
  return cost;
}

export class HordeField {
  density: Uint16Array;
  /** The other half of the double buffer; scratch between ticks. */
  private back: Uint16Array;
  /** 1 where a structure stands: a flow target that zombies can't enter. */
  readonly obstacle: Uint8Array;
  /** Density pressing on each obstacle cell this tick. */
  readonly pressure: Uint32Array;
  private readonly pressed: Int32Array;
  private numPressed = 0;
  private _total = 0;
  // Per-cell scratch for step(): neighbour cells and their weights.
  private readonly hordeNbr = new Int32Array(8);
  private readonly hordeWeight = new Float64Array(8);
  private readonly hordeShare = new Int32Array(8);

  constructor(
    readonly width: number,
    readonly height: number,
    /** Movement cost per cell, shared with the FlowField (0 = blocked). */
    readonly moveCost: Uint8Array,
    readonly cellCap: number = DEFAULT_CELL_CAP,
  ) {
    const n = width * height;
    this.density = new Uint16Array(n);
    this.back = new Uint16Array(n);
    this.obstacle = new Uint8Array(n);
    this.pressure = new Uint32Array(n);
    this.pressed = new Int32Array(n);
  }

  /** Zombies currently on the map. */
  total(): number {
    return this._total;
  }

  /** Adds up to `amount` zombies to a cell; returns how many fit. */
  add(cell: number, amount: number): number {
    const added = Math.min(amount, this.cellCap - this.density[cell]);
    if (added <= 0) return 0;
    this.density[cell] += added;
    this._total += added;
    return added;
  }

  /** Removes up to `amount` zombies from a cell; returns how many died. */
  remove(cell: number, amount: number): number {
    const removed = Math.min(amount, this.density[cell]);
    if (removed <= 0) return 0;
    this.density[cell] -= removed;
    this._total -= removed;
    return removed;
  }

  /** Replaces the density, e.g. on snapshot restore. */
  setDensity(density: Uint16Array): void {
    this.density.set(density);
    let total = 0;
    for (let i = 0; i < density.length; i++) total += density[i];
    this._total = total;
  }

  addPressure(cell: number, amount: number): void {
    if (this.pressure[cell] === 0) {
      this.pressed[this.numPressed++] = cell;
    }
    this.pressure[cell] += amount;
  }

  /** Calls `fn` for every pressed obstacle cell, then clears the pressure. */
  drainPressure(fn: (cell: number, pressure: number) => void): void {
    for (let k = 0; k < this.numPressed; k++) {
      const cell = this.pressed[k];
      fn(cell, this.pressure[cell]);
      this.pressure[cell] = 0;
      this.pressed[k] = 0;
    }
    this.numPressed = 0;
  }

  /**
   * Moves half of each cell (rounded up) one step toward the targets.
   *
   * - If the nearest neighbour is a structure, the cell presses on it
   *   instead of moving.
   * - Otherwise the outflow is split across every downhill neighbour,
   *   weighted by how far downhill it is times how much room it has left.
   *   That widens streams into hordes and steers around crowded cells.
   * - If every downhill neighbour is full, a quarter spills sideways into
   *   neighbours at the same distance, so crowds spread instead of stalling.
   *
   * Amounts are read from the current buffer and written to the other one,
   * and neighbours are visited in a fixed order, so the result is
   * deterministic.
   */
  step(dist: Uint32Array): void {
    const w = this.width;
    const h = this.height;
    const cur = this.density;
    const next = this.back;
    const cap = this.cellCap;
    const cost = this.moveCost;
    const nbr = this.hordeNbr;
    const weight = this.hordeWeight;
    const share = this.hordeShare;
    next.set(cur);
    for (let i = 0; i < cur.length; i++) {
      const d = cur[i];
      if (d === 0) continue;
      const di = dist[i];
      if (di === UNREACHABLE || di === 0) continue;
      const n = neighbours8(cost, w, h, i, nbr);

      // Press on the nearest structure, if the nearest neighbour is one.
      let best = -1;
      let bestD = di;
      for (let k = 0; k < n; k++) {
        if (dist[nbr[k]] < bestD) {
          best = nbr[k];
          bestD = dist[best];
        }
      }
      if (best < 0) continue;
      if (this.obstacle[best] !== 0) {
        this.addPressure(best, d);
        continue;
      }

      // Downhill split, weighted by drop x free room.
      let total = 0;
      for (let k = 0; k < n; k++) {
        const c = nbr[k];
        const room = cap - next[c];
        weight[k] =
          dist[c] < di && this.obstacle[c] === 0 && room > 0
            ? (di - dist[c]) * room
            : 0;
        total += weight[k];
      }
      let move = (d + 1) >> 1;
      if (total === 0) {
        // Congested: spill sideways into cells at the same distance.
        for (let k = 0; k < n; k++) {
          const c = nbr[k];
          const room = cap - next[c];
          weight[k] =
            dist[c] === di && this.obstacle[c] === 0 && room > 0 ? room : 0;
          total += weight[k];
        }
        if (total === 0) continue;
        move = (d + 3) >> 2;
      }

      let given = 0;
      for (let k = 0; k < n; k++) {
        if (weight[k] === 0) {
          share[k] = 0;
          continue;
        }
        const room = cap - next[nbr[k]];
        share[k] = Math.min(room, Math.floor((move * weight[k]) / total));
        given += share[k];
      }
      // Hand out what rounding left over, in neighbour order.
      for (let k = 0; k < n && given < move; k++) {
        if (weight[k] === 0) continue;
        const extra = Math.min(move - given, cap - next[nbr[k]] - share[k]);
        if (extra > 0) {
          share[k] += extra;
          given += extra;
        }
      }
      for (let k = 0; k < n; k++) {
        if (share[k] > 0) next[nbr[k]] += share[k];
      }
      next[i] -= given;
    }
    this.density = next;
    this.back = cur;
  }
}
