import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "../game/Game";
import { Railroad } from "../game/Railroad";

/**
 * zfront: the horde tears up railways (stage 5 of the district plan in
 * docs/zfront/spike-plan.md). On town maps Cities and Factories are only
 * captured in districts (DistrictContents.ts), so trains only run between
 * buildings a player holds; the track between two of them can still run
 * through wild ground. When `railWreckCount` zombies (an elite counts as
 * one) stand on a cell of a railroad outside its owner's held districts,
 * the horde wrecks the whole railroad: trains can't use it until it is
 * relaid, which happens for free once none of its cells has seen the horde
 * for `railRepairTicks`, while both its stations stand. Track inside held
 * ground is behind the border walls and safe.
 *
 * Deterministic: stations in the network's order, railroads in each
 * station's order, wrecks in the order they happened.
 */

export interface RailWreckOptions {
  /** 1: the horde wrecks railways through wild districts (town maps). */
  railWreck: number;
  /** Zombies on a cell of track that wreck it. */
  railWreckCount: number;
  /** Ticks a wrecked railroad's cells must be clear before it's relaid. */
  railRepairTicks: number;
}

export interface RailWreckState {
  from: number[];
  to: number[];
  clearSince: number[];
  cellCounts: number[];
  cells: number[];
  wrecked: number;
}

/** What RailWrecks reads from the horde. */
export interface RailWreckView {
  cellOf(tile: TileRef): number;
  /** Zombies on a coarse cell, elites included. */
  zombiesAt(cell: number): number;
  /** Whether `cell` is in a district player `smallID` holds. */
  heldBy(cell: number, smallID: number): boolean;
}

interface Wreck {
  /** The unit ids of the railroad's two stations. */
  from: number;
  to: number;
  /** When its cells were last seen clear of the horde, -1 while they aren't. */
  clearSince: number;
  /** Its coarse cells, each once, in track order. */
  cells: number[];
}

export class RailWrecks {
  private wrecks: Wreck[] = [];
  /** Railroads wrecked so far, for the stats. */
  private wrecked = 0;

  constructor(private opts: RailWreckOptions) {}

  enabled(): boolean {
    return this.opts.railWreck !== 0;
  }

  /** Railroads wrecked and not yet relaid. */
  brokenCount(): number {
    return this.wrecks.length;
  }

  wreckedCount(): number {
    return this.wrecked;
  }

  /** Wrecks track the horde is on and relays track it has left. */
  update(game: Game, ticks: number, view: RailWreckView): void {
    if (!this.enabled()) return;
    const network = game.railNetwork();
    const stations = network.stationManager();
    const hit: Railroad[] = [];
    for (const station of stations.getAll()) {
      for (const rail of station.getRailroads()) {
        if (rail.from !== station) continue;
        if (this.underAttack(rail, view)) hit.push(rail);
      }
    }
    for (const rail of hit) {
      const cells = this.cellsOf(rail, view);
      this.wrecks.push({
        from: rail.from.unit.id(),
        to: rail.to.unit.id(),
        clearSince: -1,
        cells,
      });
      this.wrecked++;
      network.wreckRailroad(rail);
      const owner = rail.from.unit.owner();
      game.displayMessage(
        "events_display.railway_wrecked",
        MessageType.UNIT_DESTROYED,
        owner.id(),
      );
    }
    const kept: Wreck[] = [];
    for (const w of this.wrecks) {
      const a = game.unit(w.from);
      const b = game.unit(w.to);
      const sa = a?.isActive() ? stations.findStation(a) : null;
      const sb = b?.isActive() ? stations.findStation(b) : null;
      // A station gone takes its track with it for good.
      if (sa === null || sb === null) continue;
      if (w.cells.some((c) => view.zombiesAt(c) > 0)) {
        w.clearSince = -1;
      } else if (w.clearSince < 0) {
        w.clearSince = ticks;
      } else if (ticks - w.clearSince >= this.opts.railRepairTicks) {
        network.relink(sa, sb);
        continue;
      }
      kept.push(w);
    }
    this.wrecks = kept;
  }

  /** Whether enough of the horde stands on `rail` outside held ground. */
  private underAttack(rail: Railroad, view: RailWreckView): boolean {
    const owner = rail.from.unit.owner().smallID();
    let last = -1;
    for (const t of rail.tiles) {
      const c = view.cellOf(t);
      if (c === last) continue;
      last = c;
      if (view.heldBy(c, owner)) continue;
      if (view.zombiesAt(c) >= this.opts.railWreckCount) return true;
    }
    return false;
  }

  private cellsOf(rail: Railroad, view: RailWreckView): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const t of rail.tiles) {
      const c = view.cellOf(t);
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }

  state(): RailWreckState {
    return {
      from: this.wrecks.map((w) => w.from),
      to: this.wrecks.map((w) => w.to),
      clearSince: this.wrecks.map((w) => w.clearSince),
      cellCounts: this.wrecks.map((w) => w.cells.length),
      cells: this.wrecks.flatMap((w) => w.cells),
      wrecked: this.wrecked,
    };
  }

  restore(s: RailWreckState): void {
    let at = 0;
    this.wrecks = s.from.map((from, k) => {
      const n = s.cellCounts[k];
      at += n;
      return {
        from,
        to: s.to[k],
        clearSince: s.clearSince[k],
        cells: s.cells.slice(at - n, at),
      };
    });
    this.wrecked = s.wrecked;
  }

  hash(mix: (v: number) => void): void {
    if (!this.enabled()) return;
    mix(this.wrecked);
    for (const w of this.wrecks) {
      mix(w.from);
      mix(w.to);
      mix(w.clearSince);
      mix(w.cells.length);
    }
  }
}
