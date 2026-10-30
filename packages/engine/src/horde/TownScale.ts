import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import {
  TOWN_OUTPOST_CLAIM_RADIUS,
  TOWN_TURRET_RANGE,
} from "@openfront/engine-lib/configuration/Config";
import { isTownScale } from "@openfront/engine-lib/game/MapScale";
import { HordeOptions } from "./HordeExecution";

/**
 * zfront: horde numbers for close-up town maps (3 m a tile, 1.2 km across),
 * laid over the defaults, which were tuned on continent maps.
 *
 * At this scale a zombie is a person: waves are in the hundreds rather than
 * the tens of thousands, a 6 m coarse cell holds a dense crowd at most, and
 * shamblers move at a run instead of crossing the map in seconds. Turrets
 * kill a few per volley, so bounties, mines and wall damage are scaled up to
 * match. See "Neighbourhood scale" in docs/zfront/spike-plan.md.
 */
export const TOWN_HORDE_OPTIONS: Partial<HordeOptions> = {
  firstWaveSize: 300,
  emitRate: 4,
  elitePoints: 10,
  minSpawnDistance: 40,
  maxSpawnDistance: 70,
  // The town has no shore to come in from: waves rise out of the streets
  // 240-420 m away, beyond the settled land.
  inlandSpawns: 1,
  maxElites: 40,
  shamblerSpeed: 5,
  eliteSpeed: 4,
  elitePressure: 4,
  cellCap: 12,
  turretRange: TOWN_TURRET_RANGE,
  turretKillsPerTick: 2,
  turretFireInterval: 6,
  turretEliteDamage: 80,
  pressureShift: 0,
  // A crowd of a dozen presses far less than one of two thousand, so
  // health comes down by about ten to keep the same fights.
  hqHp: 5_000,
  structureHp: 300,
  wallHp: 400,
  stoneWallHp: 1_200,
  reinforcedWallHp: 3_000,
  repairHp: 10,
  repairGoldPerHp: 10,
  killBounty: 60,
  mineRadius: 3,
  mineTrigger: 6,
  mineKills: 40,
  settleRadius: 40,
  settleRadiusPerWave: 4,
  settleCost: 20,
  refugeesPerWave: 2_000,
  outpostRadius: TOWN_OUTPOST_CLAIM_RADIUS,
  crateMinDistance: 10,
  crateMaxDistance: 40,
};

/** Horde options for `map`: the town numbers on town maps, else none. */
export function hordeOptionsForMap(map: GameMapType): Partial<HordeOptions> {
  return isTownScale(map) ? TOWN_HORDE_OPTIONS : {};
}
