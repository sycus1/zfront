import { downhill, UNREACHABLE } from "./FlowField";
import { HordeField } from "./HordeField";

/**
 * Discrete elite zombies (zfront): Runners, Brutes and the like that need
 * their own position and health. Struct-of-arrays so hundreds stay cheap.
 * They read the same flow field as the density horde.
 */
export class Elites {
  readonly cell: Int32Array;
  readonly hp: Int32Array;
  readonly cooldown: Uint8Array;
  count = 0;
  private readonly hordeScratch = new Int32Array(8);

  constructor(
    readonly capacity: number,
    /** Ticks between steps (lower is faster). */
    readonly speed: number,
    /** Pressure each elite adds to a structure it is blocked by. */
    readonly pressure: number,
  ) {
    this.cell = new Int32Array(capacity);
    this.hp = new Int32Array(capacity);
    this.cooldown = new Uint8Array(capacity);
  }

  spawn(cell: number, hp: number): boolean {
    if (this.count >= this.capacity) return false;
    const k = this.count++;
    this.cell[k] = cell;
    this.hp[k] = hp;
    this.cooldown[k] = 0;
    return true;
  }

  step(field: HordeField, dist: Uint32Array): void {
    for (let k = 0; k < this.count; k++) {
      if (this.cooldown[k] > 0) {
        this.cooldown[k]--;
        continue;
      }
      this.cooldown[k] = this.speed;
      const at = this.cell[k];
      if (dist[at] === UNREACHABLE) continue;
      const to = downhill(
        dist,
        field.moveCost,
        field.width,
        field.height,
        at,
        this.hordeScratch,
      );
      if (to < 0) continue;
      if (field.obstacle[to] !== 0) {
        field.addPressure(to, this.pressure);
      } else {
        this.cell[k] = to;
      }
    }
  }

  /** Drops elites with no health left, keeping the rest in order. */
  removeDead(): number {
    let kept = 0;
    for (let k = 0; k < this.count; k++) {
      if (this.hp[k] <= 0) continue;
      this.cell[kept] = this.cell[k];
      this.hp[kept] = this.hp[k];
      this.cooldown[kept] = this.cooldown[k];
      kept++;
    }
    const dead = this.count - kept;
    // Clear the vacated tail so the arrays hold nothing but live elites.
    this.cell.fill(0, kept, this.count);
    this.hp.fill(0, kept, this.count);
    this.cooldown.fill(0, kept, this.count);
    this.count = kept;
    return dead;
  }
}
