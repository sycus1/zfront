import { Elites } from "./Elites";
import { UNREACHABLE } from "./FlowField";
import { HordeField } from "./HordeField";

/**
 * zfront: mortars. In horde mode the Missile Silo is a mortar: a building
 * that fires on its own, every `mortarReload` ticks, at the thickest part
 * of the horde between `mortarMinRange` and `mortarRange` coarse cells
 * away. Each shell is in the air for `mortarFlight` ticks and aims where
 * the zombies it saw will have walked by then (along the flow field). When
 * it lands it kills up to `mortarKills` shamblers within
 * `mortarBlastRadius`, nearest the impact first, and hurts every elite
 * there. A mortar holds its fire until at least `mortarMinTarget` zombies
 * would be under the blast. Shells already in the air land even if their
 * mortar falls; the bounty goes to the mortar's owner.
 *
 * Mortars complement turrets: slower, longer reach, a dead zone up close,
 * and kills in bulk where the horde bunches up (at walls, or on a beacon).
 *
 * Range and blast are in coarse cells, so retuning for another map scale
 * is a matter of changing these options. Deterministic: integer state and
 * a fixed scan order.
 */

export interface MortarOptions {
  /** Longest and shortest reach, in coarse cells. */
  mortarRange: number;
  mortarMinRange: number;
  /** Ticks between shots. */
  mortarReload: number;
  /** Ticks a shell is in the air. */
  mortarFlight: number;
  /** Radius in coarse cells that a shell blows up. */
  mortarBlastRadius: number;
  /** Most shamblers one shell kills, nearest the impact first. */
  mortarKills: number;
  /** Damage to each elite within the blast. */
  mortarEliteDamage: number;
  /** Fewest shamblers under the blast worth a shell. */
  mortarMinTarget: number;
  /** Each mortar level above 1 adds this percent of the base kills and elite damage. */
  mortarLevelPercent: number;
}

/** A mortar as the shooter sees it this tick. */
export interface MortarGun {
  id: number;
  /** Its coarse cell. */
  cell: number;
  /** Its owner's smallID, who gets the bounty. */
  owner: number;
  level: number;
}

/** A shell in the air. */
export interface Shell {
  owner: number;
  /** Coarse cells it was fired from and lands on. */
  from: number;
  target: number;
  /** The tick it lands. */
  lands: number;
  /** Percent of the base kills and elite damage. */
  power: number;
}

export interface MortarState {
  /** The tick each mortar (by unit id) can next fire. */
  readyIds: number[];
  readyAt: number[];
  shells: Shell[];
  /** Shamblers killed by shells so far, for stats. */
  killed: number;
}

/** What a landed shell did. */
export interface Blast {
  owner: number;
  cell: number;
  shamblers: number;
  elites: number;
}

export class Mortars {
  private ready = new Map<number, number>();
  private shells: Shell[] = [];
  private killed = 0;
  /** Annulus a mortar can reach (dx, cell offset pairs), nearest first. */
  private reach: Int32Array;
  /** The blast disc, nearest the centre first. */
  private blast: Int32Array;

  constructor(
    private opts: MortarOptions,
    private width: number,
    private height: number,
  ) {
    this.reach = disc(opts.mortarRange, width, opts.mortarMinRange);
    this.blast = disc(opts.mortarBlastRadius, width, 0);
  }

  /** Shamblers killed by shells so far. */
  kills(): number {
    return this.killed;
  }

  /** Shells in the air. Do not mutate. */
  inFlight(): readonly Shell[] {
    return this.shells;
  }

  /**
   * Each mortar that has reloaded picks the reachable cell with the most
   * shamblers under its blast and fires there, aimed `lead` horde steps
   * ahead along `dist` (the flow field). Mortars that are gone are
   * forgotten.
   */
  fire(
    guns: readonly MortarGun[],
    ticks: number,
    field: HordeField,
    dist: Uint32Array,
    lead: number,
  ): void {
    const o = this.opts;
    if (o.mortarRange <= 0 || o.mortarReload <= 0) return;
    const seen = new Set<number>();
    for (const g of guns) {
      seen.add(g.id);
      if (ticks < (this.ready.get(g.id) ?? ticks)) continue;
      const seenAt = this.target(g.cell, field);
      if (seenAt < 0) {
        // Look again next tick.
        this.ready.set(g.id, ticks + 1);
        continue;
      }
      this.shells.push({
        owner: g.owner,
        from: g.cell,
        target: this.ahead(seenAt, lead, dist, field.moveCost),
        lands: ticks + Math.max(1, o.mortarFlight),
        power: 100 + (g.level - 1) * o.mortarLevelPercent,
      });
      this.ready.set(g.id, ticks + o.mortarReload);
    }
    for (const id of [...this.ready.keys()]) {
      if (!seen.has(id)) this.ready.delete(id);
    }
  }

  /**
   * Lands every shell due by `ticks`, in the order they were fired.
   * Returns what each one did; elites it finished are still in `elites`
   * (with no health) for the caller to remove.
   */
  land(ticks: number, field: HordeField, elites: Elites): Blast[] {
    const o = this.opts;
    const out: Blast[] = [];
    const w = this.width;
    const n = w * this.height;
    const r2 = o.mortarBlastRadius * o.mortarBlastRadius;
    let kept = 0;
    for (const s of this.shells) {
      if (s.lands > ticks) {
        this.shells[kept++] = s;
        continue;
      }
      const c = s.target;
      const cx = c % w;
      const cy = (c - cx) / w;
      let budget = Math.floor((o.mortarKills * s.power) / 100);
      let shamblers = 0;
      const offsets = this.blast;
      for (let k = 0; k < offsets.length && budget > 0; k += 2) {
        const x = cx + offsets[k];
        const cell = c + offsets[k + 1];
        if (x < 0 || x >= w || cell < 0 || cell >= n) continue;
        const removed = field.remove(cell, budget);
        budget -= removed;
        shamblers += removed;
      }
      let finished = 0;
      const damage = Math.floor((o.mortarEliteDamage * s.power) / 100);
      for (let e = 0; e < elites.count; e++) {
        const ec = elites.cell[e];
        const dx = (ec % w) - cx;
        const dy = Math.floor(ec / w) - cy;
        if (dx * dx + dy * dy > r2 || elites.hp[e] <= 0) continue;
        elites.hp[e] -= damage;
        if (elites.hp[e] <= 0) finished++;
      }
      this.killed += shamblers;
      out.push({ owner: s.owner, cell: c, shamblers, elites: finished });
    }
    this.shells.length = kept;
    return out;
  }

  /**
   * The cell within reach of `c` with the most shamblers under a blast
   * centred on it (nearest first on a tie), or -1 if none has
   * `mortarMinTarget`. Only cells with zombies of their own are tried.
   */
  private target(c: number, field: HordeField): number {
    const w = this.width;
    const n = w * this.height;
    const density = field.density;
    const cx = c % w;
    const reach = this.reach;
    const blast = this.blast;
    let best = -1;
    let bestScore = Math.max(1, this.opts.mortarMinTarget) - 1;
    for (let k = 0; k < reach.length; k += 2) {
      const x = cx + reach[k];
      const cell = c + reach[k + 1];
      if (x < 0 || x >= w || cell < 0 || cell >= n) continue;
      if (density[cell] === 0) continue;
      let score = 0;
      for (let j = 0; j < blast.length; j += 2) {
        const bx = x + blast[j];
        const b = cell + blast[j + 1];
        if (bx < 0 || bx >= w || b < 0 || b >= n) continue;
        score += density[b];
      }
      if (score > bestScore) {
        best = cell;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * Where the horde on `cell` will be after `steps` steps: each step goes
   * to the walkable neighbour nearest the target on the flow field, as
   * HordeField.step does, and stops at a target or where it can't get
   * nearer.
   */
  private ahead(
    cell: number,
    steps: number,
    dist: Uint32Array,
    cost: Uint8Array,
  ): number {
    const w = this.width;
    const h = this.height;
    let c = cell;
    for (let s = 0; s < steps; s++) {
      const d = dist[c];
      if (d === UNREACHABLE || d === 0) break;
      const x = c % w;
      const y = (c - x) / w;
      let best = -1;
      let bestD = d;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
          const nc = ny * w + nx;
          if (cost[nc] === 0 || dist[nc] >= bestD) continue;
          best = nc;
          bestD = dist[nc];
        }
      }
      if (best < 0) break;
      c = best;
    }
    return c;
  }

  state(): MortarState {
    return {
      readyIds: [...this.ready.keys()],
      readyAt: [...this.ready.values()],
      shells: this.shells.map((s) => ({ ...s })),
      killed: this.killed,
    };
  }

  restore(s: MortarState): void {
    this.ready = new Map(s.readyIds.map((id, i) => [id, s.readyAt[i]]));
    this.shells = s.shells.map((sh) => ({ ...sh }));
    this.killed = s.killed;
  }

  /** Mixes every piece of mortar state into `mix`, for the state hash. */
  hash(mix: (v: number) => void): void {
    for (const [id, at] of this.ready) {
      mix(id);
      mix(at);
    }
    for (const s of this.shells) {
      mix(s.owner);
      mix(s.from);
      mix(s.target);
      mix(s.lands);
      mix(s.power);
    }
  }
}

/**
 * (dx, cell offset) pairs for the cells from `min` to `r` coarse cells
 * away, nearest first, then row-major, so every scan goes the same way.
 */
function disc(r: number, w: number, min: number): Int32Array {
  const pts: [number, number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 >= min * min) pts.push([d2, dy, dx]);
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const out = new Int32Array(pts.length * 2);
  pts.forEach(([, dy, dx], k) => {
    out[2 * k] = dx;
    out[2 * k + 1] = dy * w + dx;
  });
  return out;
}
