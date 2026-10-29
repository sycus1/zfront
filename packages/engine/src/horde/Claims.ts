import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  HordePlaced,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../game/Game";

/**
 * Land claimed by buildings (zfront). Passive settling (Settlement.ts) only
 * fills a disc round the HQ; beyond it, land comes from buildings:
 *
 * - An Outpost may be placed on free land up to OUTPOST_REACH tiles beyond
 *   the border. It holds its own tile from the start and, once built,
 *   claims every free land tile within `outpostRadius`.
 * - Other finished buildings (not walls or mines) claim `buildingClaimRadius`,
 *   which rounds off the border round a base.
 * - A player may hold `outpostsBase` Outposts, plus one for every
 *   `wavesPerOutpost` waves survived.
 * - When an Outpost is lost, the land round it that nothing else claims
 *   (no other building, and not the passive disc) goes back to wilderness.
 *
 * Deterministic: discs are scanned in row order, units in list order.
 */

export interface ClaimOptions {
  /** Radius in tiles an Outpost claims once built. */
  outpostRadius: number;
  /** Radius in tiles other finished buildings claim. */
  buildingClaimRadius: number;
  outpostsBase: number;
  /** One more Outpost every this many waves survived; 0 for never. */
  wavesPerOutpost: number;
}

/** How far beyond the border, in tiles, an Outpost may be placed. */
export const OUTPOST_REACH = 10;

/** Outposts a player may hold after `wavesSurvived` waves. */
export function outpostLimit(
  opts: ClaimOptions,
  wavesSurvived: number,
): number {
  const extra =
    opts.wavesPerOutpost > 0
      ? Math.floor(wavesSurvived / opts.wavesPerOutpost)
      : 0;
  return opts.outpostsBase + extra;
}

/** Radius a finished unit claims, or -1 when it claims nothing. */
export function claimRadius(opts: ClaimOptions, type: UnitType): number {
  if (type === UnitType.Outpost) return opts.outpostRadius;
  if (type === UnitType.Wall || type === UnitType.Mine) return -1;
  if (Structures.has(type) || HordePlaced.has(type)) {
    return opts.buildingClaimRadius;
  }
  return -1;
}

/**
 * Where an Outpost may go: free or own land, within OUTPOST_REACH of the
 * player's land, not crowding another building, and only while the player
 * holds fewer Outposts than the limit.
 */
export function outpostSpawn(
  game: Game,
  player: Player,
  tile: TileRef,
): TileRef | false {
  if (!game.isLand(tile) || game.isImpassable(tile)) return false;
  const owner = game.owner(tile);
  if (owner.isPlayer() && owner !== player) return false;
  if (player.unitCount(UnitType.Outpost) >= game.outpostLimit()) return false;
  const crowded = game.anyUnitNearby(
    tile,
    1.5,
    [...HordePlaced.types, ...Structures.types, UnitType.Outpost],
    () => true,
    undefined,
    true,
  );
  if (crowded) return false;
  if (owner === player) return tile;
  const map = game.map();
  const me = player.smallID();
  let reached = false;
  forDisc(game, tile, OUTPOST_REACH, (t) => {
    if (!reached && map.ownerID(t) === me) reached = true;
  });
  return reached ? tile : false;
}

/**
 * Claims free land for every claiming unit `player` owns. An Outpost holds
 * its own tile even while it is being built. Returns the tiles claimed.
 */
export function applyClaims(
  game: Game,
  player: Player,
  opts: ClaimOptions,
): number {
  let claimed = 0;
  const claim = (t: TileRef) => {
    if (game.hasOwner(t) || !game.isLand(t) || game.isImpassable(t)) return;
    player.conquer(t);
    claimed++;
  };
  for (const u of player.units()) {
    if (u.type() === UnitType.Outpost) claim(u.tile());
    if (u.isUnderConstruction()) continue;
    const r = claimRadius(opts, u.type());
    if (r >= 0) forDisc(game, u.tile(), r, claim);
  }
  return claimed;
}

/**
 * An Outpost of `player` at `center` was lost: the land within its radius
 * that no remaining building claims, and that lies outside the passive disc
 * (`passiveRadius` round `hq`), goes back to wilderness. Returns the tiles
 * released.
 */
export function lapseOutpost(
  game: Game,
  player: Player,
  opts: ClaimOptions,
  center: TileRef,
  hq: TileRef | undefined,
  passiveRadius: number,
): number {
  const sources: [number, number, number][] = [];
  if (hq !== undefined) sources.push([game.x(hq), game.y(hq), passiveRadius]);
  for (const u of player.units()) {
    if (u.isUnderConstruction()) continue;
    const r = claimRadius(opts, u.type());
    if (r >= 0) sources.push([game.x(u.tile()), game.y(u.tile()), r]);
  }
  const map = game.map();
  const me = player.smallID();
  const released: TileRef[] = [];
  forDisc(game, center, opts.outpostRadius, (t) => {
    if (map.ownerID(t) !== me) return;
    const x = game.x(t);
    const y = game.y(t);
    for (const [sx, sy, r] of sources) {
      const dx = x - sx;
      const dy = y - sy;
      if (dx * dx + dy * dy <= r * r) return;
    }
    released.push(t);
  });
  for (const t of released) player.relinquish(t);
  return released.length;
}

/** Live Outposts of `player`, in unit list order. */
export function outposts(player: Player): Unit[] {
  return player.units(UnitType.Outpost).filter((u) => u.isActive());
}

/** Calls `fn` for every valid tile within `r` of `center`, in row order. */
export function forDisc(
  game: Game,
  center: TileRef,
  r: number,
  fn: (t: TileRef) => void,
): void {
  const cx = game.x(center);
  const cy = game.y(center);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (game.isValidCoord(x, y)) fn(game.ref(x, y));
    }
  }
}
