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
  // Buffer districts about 150 m across, 64 to a town (Districts.ts), or
  // the town's own hand-made ones. A crowd of 40 that lingers 10 seconds
  // overruns one.
  districtSize: 25,
  districtOverrunCount: 40,
  // Districts are the land: the game opens on the HQ's district and its
  // neighbours, nobody settles beyond them, and each Outpost takes a whole
  // district (costing more each time, see TOWN_OUTPOST_COST_STEP).
  // startingRadius, settling and outpostRadius only apply with this off.
  districtLand: 1,
  // Walls follow the borders of the districts you hold, rather than being
  // built by hand (BorderWalls.ts); "Upgrade walls" raises a district's.
  districtWalls: 1,
  // What districts hold (DistrictContents.ts): cash caches, survivors and
  // dormant buildings, more the further out. People don't grow on their
  // own here (Config.troopIncreaseRate): they start at 100,000 and come
  // from survivors, refugees and Cities, and each 100,000 pays 10 gold a
  // tick in tax, a fifth of the HQ's trickle. A woken Factory pays half
  // the trickle again.
  districtContents: 1,
  cacheGoldPerRing: 5_000,
  cachePercent: 60,
  survivorsPerRing: 20_000,
  contentMaxRing: 4,
  dormantCities: 2,
  dormantFactories: 2,
  dormantSilos: 1,
  dormantMinRing: 2,
  startingPopulation: 100_000,
  populationTax: 10,
  factoryIncome: 25,
  cityPopulation: 10,
  // Cities, Factories and Ports are only captured here (Config.capturedOnly),
  // so trains run only between buildings a player holds, paying
  // TOWN_TRAIN_GOLD a stop. Three zombies on track through the wild wreck
  // it, and it's relaid 30 seconds after the horde has gone (RailWrecks.ts).
  railWreck: 1,
  railWreckCount: 3,
  railRepairTicks: 300,
  // A town's railway station and harbour (TOWN_MAP_OPTIONS) are dormant
  // buildings; held, each brings a relief train or boat after every fourth
  // wave cleared (Relief.ts).
  reliefEvery: 4,
  reliefSurvivors: 40_000,
  reliefGold: 25_000,
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
 * docs/zfront/spike-plan.md. Walls on district borders (districtWalls) have
 * since made every defended strategy win; retuning is stage 6 of the
 * district plan ("Walls follow borders" there).
 */
export const TOWN_MAP_OPTIONS: Partial<
  Record<GameMapType, Partial<HordeOptions>>
> = {
  // Stations are the real ones, from OpenStreetMap's rail lines (see
  // scripts/realmap): Bath Spa and Sheffield. Whitby's station is just off
  // the map to the north, so its railhead is where the line comes in, and
  // its harbour is on the Esk, the nearest shore to the real one.
  [GameMapType.Bath]: {
    firstWaveSize: 185,
    waveGrowthPercent: 48,
    reliefStationX: 245,
    reliefStationY: 331,
  },
  [GameMapType.Sheffield]: {
    waveGrowthPercent: 50,
    reliefStationX: 370,
    reliefStationY: 252,
  },
  [GameMapType.Whitby]: {
    firstWaveSize: 120,
    waveGrowthPercent: 49,
    reliefStationX: 215,
    reliefStationY: 4,
    reliefHarbourX: 205,
    reliefHarbourY: 130,
  },
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
