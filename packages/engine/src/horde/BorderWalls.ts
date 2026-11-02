import { DistrictMap } from "@openfront/engine-lib/game/Districts";
import { Player } from "../game/Game";

/**
 * zfront: walls that follow district borders (stage 3 of the district plan,
 * "Walls follow borders" in docs/zfront/spike-plan.md).
 *
 * With `districtWalls` on, a wall stands on every open coarse cell of a
 * held district (Core, Held or Threatened) that has an open neighbour,
 * north, south, east or west, outside the held land. Buildings, water and
 * cliffs already block, so walls only go across the streets and open ground
 * where a border runs. As the flow field doesn't let the horde cut a corner
 * past a wall, that one line seals the held land.
 *
 * - When a district is taken, walls go up on its outer border, and those on
 *   the old border, now inside, come down.
 * - When one is lost, its walls go with it and the line behind it goes up
 *   again, whole, so losing a district falls back on the next line.
 * - A new wall that would go up on top of the horde starts broken instead.
 *
 * The horde breaks walls as it breaks spans. The wall cells of a district
 * that touch (corners count) make one stretch of wall, such as the barrier
 * across one street, with one health pool by the district's tier. When
 * that runs out the whole stretch breaks open. A broken stretch is rebuilt
 * whole, for `spanCostPerCell` a cell, once the horde is clear of it; a
 * damaged one repairs like any structure. "Upgrade walls" raises a whole
 * district's walls a tier at once, priced by how many cells of wall it
 * has, so a district with one narrow street in is cheap to fortify.
 *
 * Deterministic: walls are kept in cell order.
 */

export interface BorderWallOptions {
  /** 1: walls follow the borders of held districts (town maps). */
  districtWalls: number;
  /** Gold per wall cell to raise a district's walls from barricade to stone. */
  stoneWallCostPerCell: number;
  /** ...and from stone to reinforced. */
  reinforcedWallCostPerCell: number;
}

/** What wall repair reads from the horde's options. */
export interface WallRepairOptions {
  repairDelay: number;
  repairHp: number;
  repairGoldPerHp: number;
  spanCostPerCell: number;
}

export interface BorderWallsState {
  /** Wall cells, in cell order, and the stretch each one is part of. */
  cells: number[];
  stretch: number[];
  /** Per stretch: damage, the tick it was last hit, and broken open. */
  damage: number[];
  lastHit: number[];
  broken: boolean[];
  /** Wall tier (1-3) per district. */
  tiers: number[];
  version: number;
}

/** Highest wall tier: reinforced. */
export const MAX_WALL_TIER = 3;

export class BorderWalls {
  /** Wall cells in cell order, and the stretch each belongs to. */
  private cells: number[] = [];
  private stretch: number[] = [];
  /** Per stretch, numbered in order of their first cell. */
  private damage: number[] = [];
  private lastHit: number[] = [];
  private broken: boolean[] = [];
  /** Each stretch's cells (indices into `cells`), in cell order. */
  private members: number[][] = [];
  /** Index + 1 into `cells` of the wall on each coarse cell, 0 for none. */
  private at: Int32Array;
  /** Wall tier (1-3) per district, and wall cells per district. */
  private tiers: Uint8Array;
  private counts: Int32Array;
  /** Bumped whenever a wall goes up, comes down, breaks or is rebuilt. */
  private version = 0;

  constructor(
    private readonly map: DistrictMap,
    private readonly width: number,
    private readonly height: number,
    /** Whether the horde can walk on a coarse cell. */
    private readonly passable: (cell: number) => boolean,
  ) {
    this.at = new Int32Array(width * height);
    this.tiers = new Uint8Array(map.count).fill(1);
    this.counts = new Int32Array(map.count);
  }

  /**
   * Puts walls on the border of the held land: open cells of districts
   * where `inside` is true with an open neighbour where it isn't. A stretch
   * that keeps any of its cells keeps its damage, and stays broken if it
   * was; one that is all new goes up whole, or broken where `crowded` (the
   * horde is standing on it). A district no longer held drops back to
   * barricades.
   */
  update(
    inside: (district: number) => boolean,
    crowded: (cell: number) => boolean,
    ticks: number,
    repairDelay: number,
  ): void {
    const ids = this.map.ids;
    const w = this.width;
    const h = this.height;
    const cells: number[] = [];
    const counts = new Int32Array(this.map.count);
    const out = (n: number) => this.passable(n) && !inside(ids[n]);
    for (let c = 0; c < ids.length; c++) {
      if (!inside(ids[c]) || !this.passable(c)) continue;
      const x = c % w;
      const y = (c - x) / w;
      if (
        (y > 0 && out(c - w)) ||
        (x > 0 && out(c - 1)) ||
        (x + 1 < w && out(c + 1)) ||
        (y + 1 < h && out(c + w))
      ) {
        cells.push(c);
        counts[ids[c]]++;
      }
    }
    // The old index of each new cell's wall (-1 when it's new), before
    // `at` is pointed at the new cells.
    const old = cells.map((c) => this.at[c] - 1);
    const kept = old.filter((k) => k >= 0).length;
    const changed = kept < this.cells.length || kept < cells.length;
    for (const c of this.cells) this.at[c] = 0;
    cells.forEach((c, k) => (this.at[c] = k + 1));

    const stretch = this.label(cells);
    const n = stretch.length === 0 ? 0 : Math.max(...stretch) + 1;
    const damage = new Array<number>(n).fill(0);
    const lastHit = new Array<number>(n).fill(ticks);
    const broken = new Array<boolean>(n).fill(false);
    const fresh = new Array<boolean>(n).fill(true);
    cells.forEach((c, k) => {
      const s = stretch[k];
      const o = old[k];
      if (o < 0) {
        if (crowded(c)) broken[s] = true;
        return;
      }
      const os = this.stretch[o];
      if (fresh[s]) {
        fresh[s] = false;
        damage[s] = 0;
        lastHit[s] = this.lastHit[os];
        broken[s] = false;
      }
      damage[s] = Math.max(damage[s], this.damage[os]);
      lastHit[s] = Math.max(lastHit[s], this.lastHit[os]);
      if (this.broken[os]) broken[s] = true;
    });
    // One that couldn't go up is rebuilt as soon as the horde is clear.
    for (let s = 0; s < n; s++) {
      if (fresh[s] && broken[s]) lastHit[s] = ticks - repairDelay;
      if (broken[s]) damage[s] = 0;
    }
    if (changed) this.version++;
    this.cells = cells;
    this.stretch = stretch;
    this.damage = damage;
    this.lastHit = lastHit;
    this.broken = broken;
    this.counts = counts;
    this.members = this.memberLists();
    for (let d = 0; d < this.map.count; d++) {
      if (!inside(d)) this.tiers[d] = 1;
    }
  }

  /**
   * The stretch of each of `cells` (already in `at`): wall cells of the same
   * district joined side to side or corner to corner, numbered in order of
   * their first cell.
   */
  private label(cells: readonly number[]): number[] {
    const ids = this.map.ids;
    const w = this.width;
    const h = this.height;
    const stretch = new Array<number>(cells.length).fill(-1);
    let next = 0;
    const stack: number[] = [];
    for (let k0 = 0; k0 < cells.length; k0++) {
      if (stretch[k0] >= 0) continue;
      const s = next++;
      stretch[k0] = s;
      stack.push(k0);
      while (stack.length > 0) {
        const k = stack.pop()!;
        const c = cells[k];
        const x = c % w;
        const y = (c - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            const j = this.at[n] - 1;
            if (j < 0 || stretch[j] >= 0 || ids[n] !== ids[c]) continue;
            stretch[j] = s;
            stack.push(j);
          }
        }
      }
    }
    return stretch;
  }

  private memberLists(): number[][] {
    const members: number[][] = this.damage.map(() => []);
    this.stretch.forEach((s, k) => members[s].push(k));
    return members;
  }

  /** Changes whenever a wall goes up, comes down, breaks or is rebuilt. */
  stateVersion(): number {
    return this.version;
  }

  /** Whether a wall, standing or broken, is on coarse cell `cell`. */
  isWall(cell: number): boolean {
    return this.at[cell] !== 0;
  }

  /** Whether a standing (unbroken) wall is on coarse cell `cell`. */
  isStanding(cell: number): boolean {
    const k = this.at[cell] - 1;
    return k >= 0 && !this.broken[this.stretch[k]];
  }

  /** Calls `fn` for each standing wall's cell, in cell order. */
  forEachStanding(fn: (cell: number) => void): void {
    for (let k = 0; k < this.cells.length; k++) {
      if (!this.broken[this.stretch[k]]) fn(this.cells[k]);
    }
  }

  /**
   * Calls `fn` for each standing stretch that has taken damage, with its
   * middle cell and its damage.
   */
  forEachDamaged(fn: (cell: number, damage: number) => void): void {
    this.members.forEach((m, s) => {
      if (this.broken[s] || this.damage[s] === 0) return;
      fn(this.cells[m[m.length >> 1]], this.damage[s]);
    });
  }

  /** Cells of wall standing, and broken open waiting to be rebuilt. */
  standingCount(): number {
    let n = 0;
    for (const s of this.stretch) if (!this.broken[s]) n++;
    return n;
  }

  brokenCount(): number {
    return this.cells.length - this.standingCount();
  }

  /** District `d`'s wall tier: 1 barricade, 2 stone, 3 reinforced. */
  tier(d: number): number {
    return this.tiers[d];
  }

  /** The tier of the wall on coarse cell `cell`. */
  tierAt(cell: number): number {
    return this.tiers[this.map.ids[cell]];
  }

  /** Cells of wall, standing or broken, along district `d`'s border. */
  wallCount(d: number): number {
    return this.counts[d];
  }

  /**
   * Gold to raise district `d`'s walls a tier: its wall cells times the
   * price per cell of the next tier. 0 when there's nothing to raise (no
   * wall, or already reinforced).
   */
  upgradeCost(d: number, o: BorderWallOptions): bigint {
    const tier = this.tiers[d];
    if (tier >= MAX_WALL_TIER || this.counts[d] === 0) return 0n;
    const perCell =
      tier === 1 ? o.stoneWallCostPerCell : o.reinforcedWallCostPerCell;
    return BigInt(this.counts[d]) * BigInt(perCell);
  }

  /** Raises district `d`'s walls a tier; damage stays as it is. */
  upgrade(d: number): void {
    if (this.tiers[d] < MAX_WALL_TIER) this.tiers[d]++;
  }

  /**
   * The horde presses on the wall on `cell` for `amount`. When its
   * stretch's damage reaches `maxHp` the whole stretch breaks open and this
   * returns true.
   */
  hit(cell: number, amount: number, ticks: number, maxHp: number): boolean {
    const k = this.at[cell] - 1;
    if (k < 0) return false;
    const s = this.stretch[k];
    if (this.broken[s]) return false;
    this.damage[s] += amount;
    this.lastHit[s] = ticks;
    if (this.damage[s] < maxHp) return false;
    this.damage[s] = 0;
    this.broken[s] = true;
    this.version++;
    return true;
  }

  /**
   * Stretches left alone for `repairDelay` ticks are repaired by the holder
   * of their district, like spans: a damaged one gets `repairHp` back for
   * gold, and a broken one is rebuilt whole, for `spanCostPerCell` a cell,
   * once `clear` says the horde has gone from round all of it. Nothing
   * happens when the holder can't pay.
   */
  repair(
    ticks: number,
    o: WallRepairOptions,
    ownerOf: (cell: number) => Player | null,
    clear: (cells: readonly number[]) => boolean,
  ): void {
    this.members.forEach((m, s) => {
      if (ticks - this.lastHit[s] < o.repairDelay) return;
      if (!this.broken[s] && this.damage[s] === 0) return;
      const owner = ownerOf(this.cells[m[0]]);
      if (owner === null) return;
      if (this.broken[s]) {
        const cost = BigInt(m.length * o.spanCostPerCell);
        if (owner.gold() < cost) return;
        if (!clear(m.map((k) => this.cells[k]))) return;
        owner.removeGold(cost);
        this.broken[s] = false;
        this.version++;
        return;
      }
      let heal = Math.min(this.damage[s], o.repairHp);
      if (o.repairGoldPerHp > 0) {
        const affordable = owner.gold() / BigInt(o.repairGoldPerHp);
        if (affordable < BigInt(heal)) heal = Number(affordable);
        if (heal <= 0) return;
        owner.removeGold(BigInt(heal * o.repairGoldPerHp));
      }
      this.damage[s] -= heal;
    });
  }

  state(): BorderWallsState {
    return {
      cells: [...this.cells],
      stretch: [...this.stretch],
      damage: [...this.damage],
      lastHit: [...this.lastHit],
      broken: [...this.broken],
      tiers: Array.from(this.tiers),
      version: this.version,
    };
  }

  restore(s: BorderWallsState): void {
    if (s.tiers.length !== this.map.count) return;
    for (const c of this.cells) this.at[c] = 0;
    this.cells = [...s.cells];
    this.stretch = [...s.stretch];
    this.damage = [...s.damage];
    this.lastHit = [...s.lastHit];
    this.broken = [...s.broken];
    this.tiers = Uint8Array.from(s.tiers);
    this.version = s.version;
    this.counts = new Int32Array(this.map.count);
    this.cells.forEach((c, k) => {
      this.at[c] = k + 1;
      this.counts[this.map.ids[c]]++;
    });
    this.members = this.memberLists();
  }

  hash(mix: (v: number) => void): void {
    for (let k = 0; k < this.cells.length; k++) {
      mix(this.cells[k]);
      mix(this.stretch[k]);
    }
    for (let s = 0; s < this.damage.length; s++) {
      mix(this.damage[s]);
      mix(this.broken[s] ? 1 : 0);
    }
    for (const t of this.tiers) mix(t);
  }
}
