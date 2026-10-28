import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "../game/Game";

/**
 * Population-driven territory growth (zfront). In horde mode a human
 * player's troops are their population, and nobody clicks to expand:
 * when population passes `settlePercent` of the cap, settlers claim free
 * land along the border by themselves, paying `settleCost` population per
 * tile. They prefer tiles near the HQ, tiles under turret cover and tiles
 * that round off the border, and never move onto land the horde is on.
 *
 * The zone is capped at `zoneBaseTiles` plus `zoneTilesPerWave` for every
 * wave survived, so land follows progression. Surviving a wave also brings
 * `refugeesPerWave` x wave new people.
 *
 * Deterministic: integer scores, ties broken by tile, border tiles visited
 * in the set's insertion order.
 */

export interface SettleOptions {
  /** Ticks between settle steps. */
  settleInterval: number;
  /** Settlers leave once population is at least this percent of the cap. */
  settlePercent: number;
  /** Most tiles claimed per settle step. */
  settleTiles: number;
  /** Population spent per tile claimed. */
  settleCost: number;
  zoneBaseTiles: number;
  zoneTilesPerWave: number;
  refugeesPerWave: number;
}

/** Coarse-map context the settlers read: where the horde is and what's covered. */
export interface SettleView {
  /** Coarse cell of a tile. */
  cellOf(tile: TileRef): number;
  /** Horde density per coarse cell. */
  density: Uint16Array;
  /** 1 where a cell is inside one of this player's turrets' range. */
  covered: Uint8Array;
}

/** True when a player grows by settling and can't attack or land by boat. */
export function settlesOnItsOwn(game: Game, player: Player): boolean {
  return game.config().horde() && player.type() === PlayerType.Human;
}

/** Tiles a player's zone may hold after `wavesSurvived` waves. */
export function zoneCap(opts: SettleOptions, wavesSurvived: number): number {
  return opts.zoneBaseTiles + opts.zoneTilesPerWave * wavesSurvived;
}

// Score weights: lower scores settle first.
const DIST_WEIGHT = 4;
const NEIGHBOUR_BONUS = 8;
const COVER_BONUS = 40;

/** Runs one settle step for `player`; returns the number of tiles claimed. */
export function settle(
  game: Game,
  player: Player,
  opts: SettleOptions,
  wavesSurvived: number,
  view: SettleView,
): number {
  const room = zoneCap(opts, wavesSurvived) - player.numTilesOwned();
  if (room <= 0 || opts.settleCost <= 0) return 0;
  const threshold =
    (game.config().maxTroops(player) * opts.settlePercent) / 100;
  if (player.troops() < threshold + opts.settleCost) return 0;

  const map = game.map();
  const me = player.smallID();
  const hq = player.spawnTile();
  const hx = hq === undefined ? 0 : map.x(hq);
  const hy = hq === undefined ? 0 : map.y(hq);
  const seen = new Set<TileRef>();
  const scores: number[] = [];
  const tiles: TileRef[] = [];
  const nbuf: TileRef[] = [0, 0, 0, 0];
  const nbuf2: TileRef[] = [0, 0, 0, 0];

  player.borderTiles().forEach((border) => {
    const n = map.neighbors4(border, nbuf);
    for (let i = 0; i < n; i++) {
      const t = nbuf[i];
      if (seen.has(t)) continue;
      seen.add(t);
      if (map.hasOwner(t) || !map.isLand(t) || map.isImpassable(t)) continue;
      const cell = view.cellOf(t);
      if (view.density[cell] > 0) continue;
      let owned = 0;
      const m = map.neighbors4(t, nbuf2);
      for (let j = 0; j < m; j++) {
        if (map.ownerID(nbuf2[j]) === me) owned++;
      }
      const dist = Math.abs(map.x(t) - hx) + Math.abs(map.y(t) - hy);
      scores.push(
        dist * DIST_WEIGHT -
          owned * NEIGHBOUR_BONUS -
          (view.covered[cell] !== 0 ? COVER_BONUS : 0),
      );
      tiles.push(t);
    }
  });

  const order = tiles.map((_, k) => k);
  order.sort((a, b) => scores[a] - scores[b] || tiles[a] - tiles[b]);

  const limit = Math.min(room, opts.settleTiles, order.length);
  let claimed = 0;
  for (let k = 0; k < limit; k++) {
    if (player.troops() < threshold + opts.settleCost) break;
    player.removeTroops(opts.settleCost);
    player.conquer(tiles[order[k]]);
    claimed++;
  }
  return claimed;
}

/** Refugees who join every surviving human after wave `wave`. */
export function welcomeRefugees(
  game: Game,
  opts: SettleOptions,
  wave: number,
): void {
  const arrivals = opts.refugeesPerWave * wave;
  if (arrivals <= 0) return;
  for (const p of game.players()) {
    if (p.type() === PlayerType.Human && p.isAlive()) p.addTroops(arrivals);
  }
}
