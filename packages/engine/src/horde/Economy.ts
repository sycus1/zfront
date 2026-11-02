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
 *   scavenger depot they have built (none by default: depots bring supply
 *   drops sooner instead, see Crates.ts) and each Factory (on town maps,
 *   where Factories are woken in districts, see DistrictContents.ts),
 * - tax on their population, every tick (town maps),
 * - a bounty for every zombie their turrets kill, more for an elite,
 * - a bonus for clearing a wave (all of it spawned and nearly all of it
 *   dead before the next one starts), which grows with the wave number,
 * - a bonus for calling the next wave early, for each tick skipped,
 * - supply crates they loot (Crates.ts).
 *
 * Integers only; gold is a bigint on the player.
 */

export interface EconomyOptions {
  /** Gold per tick to each human whose HQ stands. */
  hqIncome: number;
  /** Gold per tick for each finished scavenger depot, to its owner. */
  depotIncome: number;
  /** Gold per tick for each finished Factory, to its owner. */
  factoryIncome: number;
  /** Gold per tick for every 100,000 people a human has. */
  populationTax: number;
  /**
   * People per tick each finished City brings a human, up to their cap.
   * Where people only come from capturing (Config.townPopulation), this
   * is how a City grows the population.
   */
  cityPopulation: number;
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

/**
 * Pays the HQ trickle, depot and Factory income and population tax to
 * every human still standing, and brings each one the people their
 * Cities draw in.
 */
export function payHqIncome(game: Game, opts: EconomyOptions): void {
  for (const p of game.players()) {
    if (p.type() !== PlayerType.Human || !p.isAlive()) continue;
    const depots =
      opts.depotIncome > 0 ? finished(p, UnitType.Depot) * opts.depotIncome : 0;
    const factories =
      opts.factoryIncome > 0
        ? finished(p, UnitType.Factory) * opts.factoryIncome
        : 0;
    const tax =
      opts.populationTax > 0
        ? Math.floor((p.troops() * opts.populationTax) / 100_000)
        : 0;
    const income = opts.hqIncome + depots + factories + tax;
    if (income > 0) p.addGold(BigInt(income));
    if (opts.cityPopulation > 0) {
      const room = Math.floor(game.config().maxTroops(p) - p.troops());
      const people = Math.min(
        room,
        finished(p, UnitType.City) * opts.cityPopulation,
      );
      if (people > 0) p.addTroops(people);
    }
  }
}

/** How many finished units of `type` `p` has. */
function finished(p: Player, type: UnitType): number {
  let n = 0;
  for (const u of p.units(type)) {
    if (!u.isUnderConstruction()) n++;
  }
  return n;
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
