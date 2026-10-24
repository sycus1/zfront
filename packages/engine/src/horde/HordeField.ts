import { GameMap } from "@openfront/engine-api/game/GameMap";
import { downhill, MAX_CELL_COST, UNREACHABLE } from "./FlowField";

/**
 * The mass horde as a density field (zfront): zombies per cell of the coarse
 * (map4x) grid, flowing downhill along a FlowField each tick. Cost does not
 * depend on horde size, only on map size. Integers only.
 */

export const DEFAULT_CELL_CAP = 2000;

/**
 * Movement cost per coarse cell from the terrain: 0 (blocked) for water,
 * impassable and mountain at or above `blockedMagnitude`, otherwise
 * 1 + magnitude / 4, so higher ground is slower and hordes prefer valleys.
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
      const ref = map.ref(x, y);
      if (!map.isLand(ref) || map.isImpassable(ref)) continue;
      const mag = map.magnitude(ref);
      if (mag >= blockedMagnitude) continue;
      cost[y * w + x] = Math.min(MAX_CELL_COST, 1 + (mag >> 2));
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

  constructor(
    readonly width: number,
    readonly height: number,
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
   * Moves half of each cell (rounded up) one step downhill. Density whose
   * next step is an obstacle stays put and presses on it instead. Amounts
   * are read from the current buffer and written to the other one, so the
   * result depends only on the scan order, which is fixed.
   */
  step(dist: Uint32Array): void {
    const w = this.width;
    const h = this.height;
    const cur = this.density;
    const next = this.back;
    const cap = this.cellCap;
    next.set(cur);
    for (let i = 0; i < cur.length; i++) {
      const d = cur[i];
      if (d === 0 || dist[i] === UNREACHABLE) continue;
      const to = downhill(dist, w, h, i);
      if (to < 0) continue;
      if (this.obstacle[to] !== 0) {
        this.addPressure(to, d);
        continue;
      }
      let move = (d + 1) >> 1;
      const room = cap - next[to];
      if (room <= 0) continue;
      if (move > room) move = room;
      next[i] -= move;
      next[to] += move;
    }
    this.density = next;
    this.back = cur;
  }
}
