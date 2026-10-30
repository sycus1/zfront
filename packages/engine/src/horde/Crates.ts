import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Game, Player } from "../game/Game";

/**
 * zfront: supply drops. Every human gets a crate every `crateInterval`
 * ticks (sooner with scavenger depots), dropped a short way outside their
 * border, away from their HQ. Clicking one starts looting it; once
 * `crateLootTicks` have passed the looter is paid. Any zombie within
 * `crateDangerRadius` of a crate destroys it, looted or not, and a crate
 * nobody starts looting is gone after `crateLife` ticks. A crate dropped
 * near where the announced wave comes ashore is worth more.
 *
 * Deterministic: integer state, its own seeded PRNG (so the waves' draws
 * are unchanged) and a fixed scan order. Integers only.
 */

export interface CrateOptions {
  /** Ticks between drops for each human with no depots; 0 turns drops off. */
  crateInterval: number;
  /** Crates waiting for each human at most; no more drop until one goes. */
  crateMax: number;
  /** How far outside the border a crate lands, in tiles. */
  crateMinDistance: number;
  crateMaxDistance: number;
  /** Ticks a crate lasts if nobody starts looting it. */
  crateLife: number;
  /** Ticks looting takes. */
  crateLootTicks: number;
  /** Zombies within this many coarse cells destroy a crate. */
  crateDangerRadius: number;
  /** A crate is worth this plus `crateGoldPerWave` for each wave started. */
  crateBaseGold: number;
  crateGoldPerWave: number;
  /** Within this many coarse cells of a landing, a crate is worth more. */
  crateLandingRadius: number;
  crateLandingBonusPercent: number;
  /** Each finished depot makes drops come this many percent faster. */
  depotCratePercent: number;
  /** Depots counted for faster drops, at most. */
  depotCrateMax: number;
}

/** What the crates need to know about the horde this tick. */
export interface CrateView {
  width: number;
  height: number;
  cellOf(tile: TileRef): number;
  /** Whether zombies can walk the coarse cell (so a crate can sit there). */
  passable(cell: number): boolean;
  /** Whether any zombie is on the coarse cell. */
  occupied(cell: number): boolean;
  /** Where the announced wave comes ashore. */
  landings: readonly number[];
  /** Waves started so far. */
  wave: number;
}

/** A crate as the renderer and the snapshot see it. */
export interface Crate {
  id: number;
  tile: TileRef;
  /** The human it dropped for. */
  owner: number;
  gold: number;
  /** The tick it is gone if nobody starts looting it. */
  expires: number;
  /** The tick looting finishes, or -1; and who is looting, by smallID. */
  lootEnd: number;
  looter: number;
}

export interface CrateState {
  random: [number, number, number, number];
  nextId: number;
  crates: Crate[];
  /** Drop progress per human: smallIDs and progress in hundredths of a tick. */
  progressIds: number[];
  progress: number[];
  /** Gold paid out for crates so far, for stats. */
  goldPaid: number;
}

/** One crate per this many hundredths of a tick of progress. */
const PROGRESS_PER_TICK = 100;
/** Tries to find a landing spot before waiting a tick. */
const DROP_TRIES = 8;

export class Crates {
  private crates: Crate[] = [];
  private nextId = 1;
  private progress = new Map<number, number>();
  private goldPaid = 0;
  /** Coarse-cell offsets of the danger disc, as (dx, cell offset) pairs. */
  private danger: Int32Array;

  constructor(
    private opts: CrateOptions,
    private random: PseudoRandom,
    width: number,
  ) {
    this.danger = disc(opts.crateDangerRadius, width);
  }

  /** Gold paid out for crates so far. */
  paid(): number {
    return this.goldPaid;
  }

  /** The crates on the map. Do not mutate. */
  all(): readonly Crate[] {
    return this.crates;
  }

  /**
   * `player` starts looting crate `id`. Returns false if there's no such
   * crate, someone is already looting it, or the player is not a human
   * still standing.
   */
  loot(player: Player, id: number, ticks: number): boolean {
    if (player.type() !== PlayerType.Human || !player.isAlive()) return false;
    const crate = this.crates.find((c) => c.id === id);
    if (crate === undefined || crate.lootEnd >= 0) return false;
    crate.lootEnd = ticks + this.opts.crateLootTicks;
    crate.looter = player.smallID();
    return true;
  }

  /** Destroys, pays out and expires crates, then drops new ones. */
  tick(game: Game, ticks: number, view: CrateView): void {
    if (this.opts.crateInterval <= 0) return;
    this.settle(game, ticks, view);
    this.drop(game, ticks, view);
  }

  private settle(game: Game, ticks: number, view: CrateView): void {
    let kept = 0;
    for (const crate of this.crates) {
      const looter =
        crate.lootEnd >= 0 ? playerBySmallId(game, crate.looter) : null;
      if (this.inDanger(view.cellOf(crate.tile), view)) {
        if (looter !== null) {
          game.displayMessage(
            "events_display.crate_lost",
            MessageType.UNIT_DESTROYED,
            looter.id(),
          );
        }
        continue;
      }
      if (crate.lootEnd >= 0 && ticks >= crate.lootEnd) {
        if (looter !== null && looter.isAlive()) {
          looter.addGold(BigInt(crate.gold));
          this.goldPaid += crate.gold;
          game.displayMessage(
            "events_display.crate_looted",
            MessageType.DONATION_RECEIVED,
            looter.id(),
            BigInt(crate.gold),
            { gold: crate.gold },
          );
        }
        continue;
      }
      if (crate.lootEnd < 0 && ticks >= crate.expires) continue;
      this.crates[kept++] = crate;
    }
    this.crates.length = kept;
  }

  private drop(game: Game, ticks: number, view: CrateView): void {
    const o = this.opts;
    const full = o.crateInterval * PROGRESS_PER_TICK;
    for (const p of game.players()) {
      const hq = p.spawnTile();
      if (p.type() !== PlayerType.Human || !p.isAlive() || hq === undefined) {
        continue;
      }
      let depots = 0;
      for (const u of p.units(UnitType.Depot)) {
        if (!u.isUnderConstruction()) depots++;
      }
      depots = Math.min(depots, o.depotCrateMax);
      const id = p.smallID();
      let progress =
        (this.progress.get(id) ?? 0) +
        PROGRESS_PER_TICK +
        depots * o.depotCratePercent;
      if (progress >= full) {
        const waiting = this.crates.filter((c) => c.owner === id).length;
        if (waiting < o.crateMax && this.place(game, p, hq, ticks, view)) {
          progress -= full;
        } else {
          // Ready: drops as soon as there's room and a spot.
          progress = full;
        }
      }
      this.progress.set(id, progress);
    }
  }

  /** Drops a crate for `p` outside its border, away from its HQ. */
  private place(
    game: Game,
    p: Player,
    hq: TileRef,
    ticks: number,
    view: CrateView,
  ): boolean {
    const o = this.opts;
    const map = game.map();
    const border = [...p.borderTiles()];
    if (border.length === 0) return false;
    const hx = map.x(hq);
    const hy = map.y(hq);
    for (let k = 0; k < DROP_TRIES; k++) {
      const a = border[this.random.nextInt(0, border.length)];
      const d = this.random.nextInt(o.crateMinDistance, o.crateMaxDistance + 1);
      const dx = map.x(a) - hx;
      const dy = map.y(a) - hy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      const x = map.x(a) + Math.round((dx * d) / len);
      const y = map.y(a) + Math.round((dy * d) / len);
      if (!map.isValidCoord(x, y)) continue;
      const tile = map.ref(x, y);
      if (!map.isLand(tile) || map.ownerID(tile) === p.smallID()) continue;
      const cell = view.cellOf(tile);
      if (!view.passable(cell) || this.inDanger(cell, view)) continue;
      if (this.crates.some((c) => view.cellOf(c.tile) === cell)) continue;
      this.crates.push({
        id: this.nextId++,
        tile,
        owner: p.smallID(),
        gold: this.value(cell, view),
        expires: ticks + o.crateLife,
        lootEnd: -1,
        looter: 0,
      });
      return true;
    }
    return false;
  }

  private value(cell: number, view: CrateView): number {
    const o = this.opts;
    const gold = o.crateBaseGold + Math.max(1, view.wave) * o.crateGoldPerWave;
    const w = view.width;
    const cx = cell % w;
    const cy = (cell - cx) / w;
    const r2 = o.crateLandingRadius * o.crateLandingRadius;
    for (const l of view.landings) {
      const lx = l % w;
      const ly = (l - lx) / w;
      const dx = lx - cx;
      const dy = ly - cy;
      if (dx * dx + dy * dy <= r2) {
        return Math.floor((gold * (100 + o.crateLandingBonusPercent)) / 100);
      }
    }
    return gold;
  }

  private inDanger(cell: number, view: CrateView): boolean {
    const w = view.width;
    const n = w * view.height;
    const cx = cell % w;
    const offsets = this.danger;
    for (let k = 0; k < offsets.length; k += 2) {
      const x = cx + offsets[k];
      const c = cell + offsets[k + 1];
      if (x < 0 || x >= w || c < 0 || c >= n) continue;
      if (view.occupied(c)) return true;
    }
    return false;
  }

  state(): CrateState {
    return {
      random: this.random.getState(),
      nextId: this.nextId,
      crates: this.crates.map((c) => ({ ...c })),
      progressIds: [...this.progress.keys()],
      progress: [...this.progress.values()],
      goldPaid: this.goldPaid,
    };
  }

  restore(s: CrateState): void {
    this.random = PseudoRandom.fromState(s.random);
    this.nextId = s.nextId;
    this.crates = s.crates.map((c) => ({ ...c }));
    this.progress = new Map(s.progressIds.map((id, i) => [id, s.progress[i]]));
    this.goldPaid = s.goldPaid;
  }

  /** Mixes every piece of crate state into `mix`, for the state hash. */
  hash(mix: (v: number) => void): void {
    mix(this.nextId);
    for (const c of this.crates) {
      mix(c.id);
      mix(c.tile);
      mix(c.gold);
      mix(c.expires);
      mix(c.lootEnd);
      mix(c.looter);
    }
    for (const [id, p] of this.progress) {
      mix(id);
      mix(p);
    }
  }
}

function playerBySmallId(game: Game, id: number): Player | null {
  const p = game.playerBySmallID(id);
  return p.isPlayer() ? p : null;
}

/** (dx, cell offset) pairs for every cell within `r` of a cell. */
function disc(r: number, w: number): Int32Array {
  const out: number[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) out.push(dx, dy * w + dx);
    }
  }
  return Int32Array.from(out);
}
