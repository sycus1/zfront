import {
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "../game/Game";

/**
 * The horde mode's cash economy (zfront). OpenFront's flat gold per tick is
 * off for humans in horde mode (EngineConfig.goldAdditionRate); instead
 * each human earns:
 *
 * - an HQ trickle every tick while their HQ stands, and more for each
 *   scavenger depot they have built,
 * - a bounty for every zombie their turrets kill, more for an elite,
 * - a bonus for clearing a wave (all of it spawned and nearly all of it
 *   dead before the next one starts), which grows with the wave number,
 * - a bonus for calling the next wave early, for each tick skipped.
 *
 * Integers only; gold is a bigint on the player.
 */

export interface EconomyOptions {
  /** Gold per tick to each human whose HQ stands. */
  hqIncome: number;
  /** Gold per tick for each finished scavenger depot, to its owner. */
  depotIncome: number;
  /** Gold per shambler killed, to the turret's owner. */
  killBounty: number;
  /** Gold per elite killed, to the owner of the turret that finished it. */
  eliteBounty: number;
  /** Gold for clearing wave N is N times this, to every surviving human. */
  clearBonusPerWave: number;
  /**
   * A wave counts as cleared once it has all spawned and at most this
   * percent of its size is still alive (HordeExecution.checkCleared).
   */
  clearedPercent: number;
  /** Gold for each tick of the break skipped by calling a wave early. */
  callEarlyGoldPerTick: number;
}

/** Pays the HQ trickle and depot income to every human still standing. */
export function payHqIncome(game: Game, opts: EconomyOptions): void {
  for (const p of game.players()) {
    if (p.type() !== PlayerType.Human || !p.isAlive()) continue;
    let depots = 0;
    if (opts.depotIncome > 0) {
      for (const u of p.units(UnitType.Depot)) {
        if (!u.isUnderConstruction()) depots++;
      }
    }
    const income = opts.hqIncome + depots * opts.depotIncome;
    if (income > 0) p.addGold(BigInt(income));
  }
}

/** Pays `owner` for `shamblers` shamblers and `elites` elites killed. */
export function payBounty(
  owner: Player,
  opts: EconomyOptions,
  shamblers: number,
  elites: number,
): void {
  const gold = shamblers * opts.killBounty + elites * opts.eliteBounty;
  if (gold > 0) owner.addGold(BigInt(gold));
}

/** Pays the bonus for clearing wave `wave` and tells each player. */
export function payClearBonus(
  game: Game,
  opts: EconomyOptions,
  wave: number,
): void {
  payEveryone(
    game,
    wave * opts.clearBonusPerWave,
    "events_display.wave_cleared",
    wave,
  );
}

/** Pays the bonus for calling wave `wave` with `ticksSkipped` of the break left. */
export function payCallEarlyBonus(
  game: Game,
  opts: EconomyOptions,
  wave: number,
  ticksSkipped: number,
): void {
  payEveryone(
    game,
    ticksSkipped * opts.callEarlyGoldPerTick,
    "events_display.wave_called",
    wave,
  );
}

/** Gold to every human still standing, with a message naming the wave. */
function payEveryone(
  game: Game,
  gold: number,
  message: string,
  wave: number,
): void {
  if (gold <= 0) return;
  for (const p of game.players()) {
    if (p.type() !== PlayerType.Human || !p.isAlive()) continue;
    p.addGold(BigInt(gold));
    game.displayMessage(
      message,
      MessageType.DONATION_RECEIVED,
      p.id(),
      BigInt(gold),
      { wave, gold },
    );
  }
}
