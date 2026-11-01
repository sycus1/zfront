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
  firstWaveSize: 150,
  // Packed crowds make a bigger wave press harder, so growth bites: about
  // 4,300 on wave 10. Each town sets its own in TOWN_MAP_OPTIONS.
  waveGrowthPercent: 45,
  emitRate: 4,
  elitePoints: 10,
  minSpawnDistance: 40,
  maxSpawnDistance: 70,
  // The town has no shore to come in from: waves rise out of the streets
  // 240-420 m away, beyond the settled land.
  inlandSpawns: 1,
  maxElites: 40,
  shamblerSpeed: 3,
  eliteSpeed: 2,
  elitePressure: 4,
  // Packed crowds that move: a turret or two can't hold a street on their
  // own, so bigger waves press harder (see "Town balance" in spike-plan.md).
  cellCap: 40,
  turretRange: TOWN_TURRET_RANGE,
  turretKillsPerTick: 2,
  turretFireInterval: 6,
  turretEliteDamage: 80,
  // Mortars out-range turrets (210 m) and a shell lands on a crowd of at
  // most a hundred or so, so it kills a few dozen, not hundreds.
  mortarRange: 35,
  mortarMinRange: 6,
  mortarReload: 50,
  mortarFlight: 15,
  mortarBlastRadius: 2,
  mortarKills: 25,
  mortarEliteDamage: 120,
  mortarMinTarget: 8,
  pressureShift: 0,
  // A crowd of a dozen presses far less than one of two thousand, so
  // health comes down by about ten to keep the same fights.
  hqHp: 5_000,
  structureHp: 300,
  // A turret is what a crowd presses on first, and a packed street of 40 a
  // cell presses hard: at 300 a lone first turret fell to wave 1 from about
  // half the HQ spots on Bath. 2,000 holds wave 1 from all of them (see
  // `npm run balance:horde -- --zone 0 --map Bath --strategy lone`).
  turretHp: 2_000,
  wallHp: 400,
  stoneWallHp: 1_200,
  reinforcedWallHp: 3_000,
  repairHp: 10,
  repairGoldPerHp: 10,
  killBounty: 60,
  mineRadius: 3,
  mineTrigger: 6,
  mineKills: 40,
  // The game opens on a whole neighbourhood, 180 m across each way.
  startingRadius: 60,
  settleRadius: 60,
  settleRadiusPerWave: 4,
  settleCost: 20,
  refugeesPerWave: 2_000,
  outpostRadius: TOWN_OUTPOST_CLAIM_RADIUS,
  crateMinDistance: 10,
  crateMaxDistance: 40,
};

/**
 * Per-town changes laid over TOWN_HORDE_OPTIONS, so the towns are about
 * equally hard. Street layout decides how many fronts a crowd presses on:
 * Bath's narrow streets let a few turrets hold, Whitby's open ground and
 * harbour sides let crowds spread round them. The first wave sets how hard
 * the opening is; growth sets how hard the late waves are, and went up a
 * little per town when turrets got tougher (turretHp). Tuned with
 * `npm run balance:horde -- --zone 0 --map <town>` so a lone first turret
 * holds wave 1 and the defended strategies still lose some games late
 * (wave 9 or 10). See "Per-town difficulty" and "Turret health" in
 * docs/zfront/spike-plan.md.
 */
export const TOWN_MAP_OPTIONS: Partial<
  Record<GameMapType, Partial<HordeOptions>>
> = {
  [GameMapType.Bath]: { firstWaveSize: 185, waveGrowthPercent: 48 },
  [GameMapType.Sheffield]: { waveGrowthPercent: 50 },
  [GameMapType.Whitby]: { firstWaveSize: 120, waveGrowthPercent: 49 },
};

/**
 * Horde options for `map`: the town numbers, plus the map's own changes,
 * on town maps, else none.
 */
export function hordeOptionsForMap(map: GameMapType): Partial<HordeOptions> {
  if (!isTownScale(map)) return {};
  const own = TOWN_MAP_OPTIONS[map];
  return own === undefined
    ? TOWN_HORDE_OPTIONS
    : { ...TOWN_HORDE_OPTIONS, ...own };
}
