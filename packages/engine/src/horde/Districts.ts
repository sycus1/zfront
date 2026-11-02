import {
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  DistrictMap,
  districtMap,
  DistrictState,
  MapDistrictIds,
} from "@openfront/engine-lib/game/Districts";
import { Game, Player } from "../game/Game";

/**
 * zfront: buffer districts. The map is cut into districts (engine-lib
 * `game/Districts`: the map's own hand-made ones if it has them, else a
 * jittered grid) and each one is Wild, Securing, Held or Core:
 *
 * - **Core**: the district with a player's HQ, or one with no Outpost
 *   where they own at least `districtCorePercent` of the open ground. It
 *   is never overrun. When districts are the land (`districtLand`), Core
 *   is the HQ's district and its neighbours, the land a player starts
 *   with, and nothing else.
 * - **Securing**: a finished Outpost stands in it (outside the HQ's
 *   district), however much of it is settled. Once no zombie has been
 *   in it for `districtSecureTicks`, it is Held.
 * - **Held**: a buffer. It needn't be settled land; the Outpost holds it.
 *   If `districtOverrunCount` zombies or more stay in it for
 *   `districtOverrunTicks` it is overrun: it goes back to the wild and its
 *   Outpost is lost (HordeExecution.updateDistricts). It is Threatened
 *   while that count is running. An Outpost doesn't draw the horde.
 * - **Wild**: anything else.
 *
 * No wave rises in a Core or Held district, nor in a district next to a
 * Held one (HordeExecution.surveySpawns), so each district held out from
 * the base keeps the waves off a whole stretch of that side, and holding a
 * ring of them pushes the waves further out or closes a direction. Supply
 * crates only drop in or next to a player's own districts, and are worth
 * more in a Held one (Crates.ts).
 *
 * When districts are the land, a player owns every tile of the districts
 * they hold, and an Outpost may only go in a Wild district next to one of
 * theirs (`outpostSite`); HordeExecution.syncDistrictLand hands the land
 * over as districts are secured and lost.
 *
 * Deterministic: integer state, districts visited in id order, players in
 * player order, units in list order.
 */

export interface DistrictOptions {
  /**
   * District size in coarse cells for maps without hand-made districts;
   * 0 turns districts off on every map.
   */
  districtSize: number;
  /** Ticks with no zombie in it before an Outpost's district is Held. */
  districtSecureTicks: number;
  /** Zombies in a Held district (an elite counts as one) that overrun it... */
  districtOverrunCount: number;
  /** ...if they stay this many ticks. */
  districtOverrunTicks: number;
  /** A district where a player owns this percent of the open ground is Core. */
  districtCorePercent: number;
  /**
   * 1: districts are the land. A player starts with their HQ's district
   * and its neighbours (Core), owns every tile of each district they hold,
   * and takes more only with Outposts, in Wild districts next to theirs.
   */
  districtLand: number;
}

export interface DistrictsState {
  holder: number[];
  status: number[];
  timer: number[];
}

/** What the districts read from the horde each update. */
export interface DistrictView {
  /** Coarse cell of a tile. */
  cellOf(tile: number): number;
  density: Uint16Array;
  eliteCells: ArrayLike<number>;
}

/** Ticks between district updates. */
export const DISTRICT_INTERVAL = 10;

export class Districts {
  readonly map: DistrictMap;
  /** Open (walkable) coarse cells per district. */
  private open: Int32Array;
  /** Each district's cells, in row order: cells[first[d]..first[d + 1]). */
  private cellList: Int32Array;
  private first: Int32Array;
  /** smallID of the holder per district, 0 for nobody. */
  private holder: Int32Array;
  private status: Uint8Array;
  /** Securing: ticks clear so far. Threatened: ticks overrun so far. */
  private timer: Int32Array;
  /** 1 for each district no wave may rise in; see blocksSpawn. */
  private noSpawn: Uint8Array;

  constructor(
    private opts: DistrictOptions,
    private width: number,
    height: number,
    passable: (cell: number) => boolean,
    /** The map's hand-made districts (Game.mapDistricts), if any. */
    own?: MapDistrictIds,
  ) {
    this.map = districtMap(width, height, opts.districtSize, own);
    const n = this.map.count;
    this.open = new Int32Array(n);
    const ids = this.map.ids;
    this.first = new Int32Array(n + 1);
    for (let c = 0; c < ids.length; c++) {
      if (passable(c)) this.open[ids[c]]++;
      this.first[ids[c] + 1]++;
    }
    for (let d = 0; d < n; d++) this.first[d + 1] += this.first[d];
    this.cellList = new Int32Array(ids.length);
    const next = this.first.slice(0, n);
    for (let c = 0; c < ids.length; c++) this.cellList[next[ids[c]]++] = c;
    this.holder = new Int32Array(n);
    this.status = new Uint8Array(n);
    this.timer = new Int32Array(n);
    this.noSpawn = new Uint8Array(n);
  }

  enabled(): boolean {
    return this.map.size > 0;
  }

  districtOf(cell: number): number {
    return this.map.ids[cell];
  }

  /** Core or Held (Threatened too): no wave rises there. */
  isClaimed(d: number): boolean {
    const s = this.status[d];
    return (
      s === DistrictState.Core ||
      s === DistrictState.Held ||
      s === DistrictState.Threatened
    );
  }

  /**
   * Whether waves may not rise on coarse cell `cell`: it is in a Core or
   * Held district, or next to a Held one.
   */
  blocksSpawn(cell: number): boolean {
    return this.enabled() && this.noSpawn[this.map.ids[cell]] !== 0;
  }

  private markNoSpawn(): void {
    const n = this.map.count;
    this.noSpawn.fill(0);
    for (let i = 0; i < n; i++) {
      if (!this.isClaimed(i)) continue;
      this.noSpawn[i] = 1;
      if (this.status[i] === DistrictState.Core) continue;
      for (const j of this.map.neighbours[i]) this.noSpawn[j] = 1;
    }
  }

  /** The smallID holding district `d` (Core or Held), or 0. */
  claimedBy(d: number): number {
    return this.isClaimed(d) ? this.holder[d] : 0;
  }

  /** The smallID with an Outpost or a claim on district `d`, or 0. */
  holderOf(d: number): number {
    return this.status[d] === DistrictState.Wild ? 0 : this.holder[d];
  }

  /** District `d`'s coarse cells, in row order. */
  cellsOf(d: number): Int32Array {
    return this.cellList.subarray(this.first[d], this.first[d + 1]);
  }

  /** The districts a player whose HQ is on `cell` starts with. */
  homeDistricts(cell: number): number[] {
    const d = this.map.ids[cell];
    return [d, ...this.map.neighbours[d]];
  }

  /**
   * Whether the player `smallID` may put an Outpost on `cell` when
   * districts are the land: its district is Wild and borders one they
   * hold, so land is taken a district at a time, outwards.
   */
  outpostSite(smallID: number, cell: number): boolean {
    if (!this.enabled()) return false;
    const d = this.map.ids[cell];
    if (this.status[d] !== DistrictState.Wild) return false;
    return this.map.neighbours[d].some((n) => this.claimedBy(n) === smallID);
  }

  /**
   * Where a crate for `owner` may drop on `cell`: 0 not at all, 1 in or next
   * to one of their districts, 2 in one they hold as a buffer (worth more).
   * Always 1 with districts off.
   */
  crateSpot(cell: number, owner: number): 0 | 1 | 2 {
    if (!this.enabled()) return 1;
    const d = this.map.ids[cell];
    if (this.claimedBy(d) === owner) {
      return this.status[d] === DistrictState.Core ? 1 : 2;
    }
    for (const n of this.map.neighbours[d]) {
      if (this.claimedBy(n) === owner) return 1;
    }
    return 0;
  }

  /**
   * Brings every district's state up to date, `dt` ticks after the last
   * update, and tells each player when one is secured or overrun. Returns
   * whether the set of claimed districts changed.
   */
  update(
    game: Game,
    dt: number,
    view: DistrictView,
    /** The districts overrun in this update are pushed here. */
    overrun: number[] = [],
  ): boolean {
    if (!this.enabled()) return false;
    const o = this.opts;
    const map = game.map();
    const ids = this.map.ids;
    const n = this.map.count;
    const humans = game
      .players()
      .filter((p) => p.type() === PlayerType.Human && p.isAlive());

    const zombies = new Int32Array(n);
    const d = view.density;
    for (let c = 0; c < d.length; c++) {
      if (d[c] !== 0) zombies[ids[c]] += d[c];
    }
    for (let k = 0; k < view.eliteCells.length; k++) {
      zombies[ids[view.eliteCells[k]]]++;
    }

    // Ground each human owns per district, sampled at each coarse cell's
    // top-left tile. Not needed when districts are the land.
    const land = o.districtLand !== 0;
    const owned = humans.map(() => new Int32Array(n));
    if (humans.length > 0 && !land) {
      const index = new Map(humans.map((p, k) => [p.smallID(), k]));
      const mw = map.width();
      const mh = map.height();
      for (let c = 0; c < ids.length; c++) {
        const x = c % this.width;
        const y = (c - x) / this.width;
        const tx = x * 2;
        const ty = y * 2;
        if (tx >= mw || ty >= mh) continue;
        const k = index.get(map.ownerID(map.ref(tx, ty)));
        if (k !== undefined) owned[k][ids[c]]++;
      }
    }

    const home = new Int32Array(n);
    const core = new Int32Array(n);
    const anchor = new Int32Array(n);
    humans.forEach((p, k) => {
      const id = p.smallID();
      for (let i = 0; i < n && !land; i++) {
        if (
          core[i] === 0 &&
          this.open[i] > 0 &&
          owned[k][i] * 100 >= this.open[i] * o.districtCorePercent
        ) {
          core[i] = id;
        }
      }
      const hq = p.spawnTile();
      if (hq !== undefined) {
        const cell = view.cellOf(hq);
        if (land) {
          for (const i of this.homeDistricts(cell)) {
            if (home[i] === 0) home[i] = id;
          }
        } else {
          home[ids[cell]] = id;
        }
      }
      for (const u of p.units(UnitType.Outpost)) {
        if (!u.isActive() || u.isUnderConstruction()) continue;
        const i = ids[view.cellOf(u.tile())];
        if (anchor[i] === 0) anchor[i] = id;
      }
    });

    let changed = false;
    for (let i = 0; i < n; i++) {
      const was = this.isClaimed(i);
      const wasHolder = this.holder[i];
      const s = this.status[i];
      if (home[i] !== 0) {
        this.set(i, home[i], DistrictState.Core, 0);
      } else if (anchor[i] !== 0) {
        const holder = anchor[i];
        const holding =
          wasHolder === holder &&
          (s === DistrictState.Held ||
            s === DistrictState.Threatened ||
            s === DistrictState.Core);
        if (holding) {
          if (zombies[i] >= o.districtOverrunCount) {
            const t = (s === DistrictState.Threatened ? this.timer[i] : 0) + dt;
            if (t >= o.districtOverrunTicks) {
              this.set(i, 0, DistrictState.Wild, 0);
              overrun.push(i);
              this.tell(game, holder, "events_display.district_overrun");
            } else {
              this.set(i, holder, DistrictState.Threatened, t);
            }
          } else {
            this.set(i, holder, DistrictState.Held, 0);
          }
        } else {
          const prior =
            wasHolder === holder && s === DistrictState.Securing
              ? this.timer[i]
              : 0;
          const t = zombies[i] === 0 ? prior + dt : 0;
          if (t >= o.districtSecureTicks) {
            this.set(i, holder, DistrictState.Held, 0);
            this.tell(game, holder, "events_display.district_secured");
          } else {
            this.set(i, holder, DistrictState.Securing, t);
          }
        }
      } else if (core[i] !== 0) {
        this.set(i, core[i], DistrictState.Core, 0);
      } else {
        this.set(i, 0, DistrictState.Wild, 0);
      }
      if (this.isClaimed(i) !== was || (was && this.holder[i] !== wasHolder)) {
        changed = true;
      }
    }
    if (changed) this.markNoSpawn();
    return changed;
  }

  private set(i: number, holder: number, status: number, timer: number) {
    this.holder[i] = holder;
    this.status[i] = status;
    this.timer[i] = timer;
  }

  private tell(game: Game, smallID: number, message: string): void {
    const p = game.playerBySmallID(smallID);
    if (!p.isPlayer()) return;
    game.displayMessage(
      message,
      message.endsWith("overrun")
        ? MessageType.UNIT_DESTROYED
        : MessageType.CAPTURED_ENEMY_UNIT,
      (p as Player).id(),
    );
  }

  /** One state byte per district, for the frame (DistrictState). */
  encode(): Uint8Array {
    return this.enabled() ? this.status.slice() : new Uint8Array();
  }

  state(): DistrictsState {
    return {
      holder: Array.from(this.holder),
      status: Array.from(this.status),
      timer: Array.from(this.timer),
    };
  }

  restore(s: DistrictsState): void {
    if (s.status.length !== this.map.count) return;
    this.holder = Int32Array.from(s.holder);
    this.status = Uint8Array.from(s.status);
    this.timer = Int32Array.from(s.timer);
    this.markNoSpawn();
  }

  hash(mix: (v: number) => void): void {
    if (!this.enabled()) return;
    for (let i = 0; i < this.map.count; i++) {
      mix(this.holder[i]);
      mix(this.status[i]);
      mix(this.timer[i]);
    }
  }
}
