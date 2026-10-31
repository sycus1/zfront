import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  HordeFrame,
  HordeOutcome,
} from "@openfront/engine-api/game/GameUpdates";
import {
  HORDE_TURRET_RANGE,
  OUTPOST_CLAIM_RADIUS,
} from "@openfront/engine-lib/configuration/Config";
import { hordeDensityByte } from "@openfront/engine-lib/game/HordeCells";
import {
  HORDE_BLOCKED_MAGNITUDE,
  WALL_SNAP_RADIUS,
} from "@openfront/engine-lib/game/HordeTerrain";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zRandom,
  zU16Array,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { DefensePostExecution } from "../execution/DefensePostExecution";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";
import { BuildingOptions, beaconSounding, detonate } from "./Buildings";
import {
  applyClaims,
  ClaimOptions,
  lapseOutpost,
  outpostLimit,
  outposts,
} from "./Claims";
import { Crate, CrateOptions, Crates, CrateState } from "./Crates";
import {
  payBounty,
  payCallEarlyBonus,
  payClearBonus,
  payHqIncome,
  EconomyOptions,
} from "./Economy";
import { Elites } from "./Elites";
import { FlowField, ORTHO_STEP, WALL_COST } from "./FlowField";
import { buildCostField, HordeField } from "./HordeField";
import { MortarGun, MortarOptions, Mortars, MortarState } from "./Mortars";
import {
  passiveRadius,
  settle,
  SettleOptions,
  welcomeRefugees,
} from "./Settlement";
import { chooseLinks, LinkGrid, LinkPost, WallLink } from "./WallLinks";
import { WaveDirector, WavePlan } from "./WaveDirector";
import { readyToFire } from "./Weapons";

/**
 * Zombie waves (zfront spike). The mass horde is a density field on the
 * coarse map that flows toward player structures; elites are discrete
 * agents on the same flow field. Structures are obstacles: blocked zombies
 * press on them until they fall. Walls are obstacles too, but not targets:
 * the horde goes round them where it can and breaks through where it must.
 * Each new wall post links to nearby posts and mountains with spans that
 * block like walls (see WallLinks). Defense Posts stand in for turrets and
 * Missile Silos for mortars (see Mortars). The WaveDirector plans each
 * wave's size and directions.
 *
 * The player wins by keeping their HQ standing until the wave after
 * `wavesToWin` would arrive, and loses when every human HQ has fallen.
 * A loss stops the horde; after a win the waves go on without end, for
 * players who keep playing.
 *
 * Deterministic: integer state, a seeded PRNG for spawn points, and a fixed
 * scan order everywhere. Timings are recorded for the perf harness only and
 * never feed back into the simulation.
 */

export interface HordeOptions
  extends
    SettleOptions,
    ClaimOptions,
    EconomyOptions,
    BuildingOptions,
    CrateOptions,
    MortarOptions {
  /** Ticks from the end of the spawn phase to the first wave. */
  firstWaveDelay: number;
  /**
   * Build time after a wave is cleared, in ticks. The next wave's countdown
   * only starts once the wave under way is cleared and this has run out.
   */
  downtimeTicks: number;
  /** The countdown to the next wave that follows the downtime, in ticks. */
  waveCountdown: number;
  /**
   * A wave that still isn't cleared this long after it started is treated
   * as outlasted and the downtime starts anyway, so stragglers stuck out of
   * reach can't stall the game; 0 waits for the clear however long it takes.
   */
  maxWaveTicks: number;
  /** Points for the first wave: one per shambler, `elitePoints` per elite. */
  firstWaveSize: number;
  /** Each wave's budget is this many percent bigger than the last. */
  waveGrowthPercent: number;
  emittersPerWave: number;
  /** Zombies each emitter releases per tick until its share is out. */
  emitRate: number;
  /** Elites in the first wave; later waves scale with the budget. */
  elitesPerWave: number;
  elitePoints: number;
  /** Waves come from one more direction every this many waves. */
  wavesPerDirection: number;
  /** Waves don't come ashore closer than this to the HQ (coarse cells). */
  minSpawnDistance: number;
  /** Nor further than this, where there is coast in between; 0 = no limit. */
  maxSpawnDistance: number;
  /**
   * 1 lets waves rise from any open cell, as on town maps where the horde
   * comes out of the streets; 0 only from the shore and the map edge.
   */
  inlandSpawns: number;
  maxElites: number;
  eliteHp: number;
  /**
   * Ticks between horde (shambler) steps (lower is faster). Shamblers
   * press on what blocks them as they step, so this also spaces out their
   * attacks.
   */
  shamblerSpeed: number;
  /** Ticks between elite steps (lower is faster). */
  eliteSpeed: number;
  elitePressure: number;
  /** Terrain magnitude at which Shamblers can no longer climb. */
  blockedMagnitude: number;
  cellCap: number;
  /** Turret range in coarse cells (one coarse cell is 2x2 tiles). */
  turretRange: number;
  turretKillsPerTick: number;
  /**
   * Turrets fire every this many ticks, each volley killing up to
   * `turretKillsPerTick` (so town maps, with zombies in the hundreds, can
   * kill fewer than one a tick).
   */
  turretFireInterval: number;
  turretEliteDamage: number;
  /** Structure damage per tick is pressure >> pressureShift. */
  pressureShift: number;
  structureHp: number;
  /** Wall health by tier: barricade, stone, reinforced (levels 1-3). */
  wallHp: number;
  stoneWallHp: number;
  reinforcedWallHp: number;
  /** How far, in coarse cells, a new wall post reaches to link up. */
  wallSnapRadius: number;
  /** Gold per cell a span fills, paid when it is built or rebuilt. */
  spanCostPerCell: number;
  /**
   * No wall post goes up, and no span is built, within this many coarse
   * cells of the horde: builders can't get through a push.
   */
  wallClearRadius: number;
  /** Each turret level above 1 adds this percent of the base kill rate. */
  turretLevelPercent: number;
  /** Extra turret range, in coarse cells, per 10 points of terrain height. */
  turretHighGroundBonus: number;
  /** Ticks without an attack before a structure starts to repair. */
  repairDelay: number;
  /** Ticks between repair steps. */
  repairInterval: number;
  /** Health each damaged structure gets back per repair step. */
  repairHp: number;
  /** Gold the owner pays per point of health repaired. */
  repairGoldPerHp: number;
  /** HQ health. When it falls, the player loses. */
  hqHp: number;
  /** Waves to survive to win; 0 means endless. */
  wavesToWin: number;
  /** Free turrets built next to each human HQ when the game starts. */
  startingTurrets: number;
  /**
   * Ticks the structure set must stay unchanged before the flow field is
   * recomputed, so placing a row of walls costs one recompute, not one each.
   */
  flowDebounce: number;
  /** Longest a recompute may wait while structures keep changing. */
  flowMaxDelay: number;
}

// MVP defaults, tuned with `npm run balance:horde` (see "MVP: balance",
// "MVP: defences", "MVP: economy" and "Downtime between waves" in
// docs/zfront/spike-plan.md): a minute to build before the first wave of
// 2,500. Once a wave is cleared there are 90 seconds to build, then a
// 30-second countdown to the next, each 40% bigger, to about 52k on wave
// 10, coming ashore 30 to 60 coarse cells out, and shamblers that walk a
// coarse cell every 3 ticks. Gold comes from the
// HQ, turret kills, cleared waves and supply crates the player loots (see
// "Supply drops" in docs/zfront/spike-plan.md). An undefended HQ falls on
// wave 2 or 3; a ring of upgraded turrets wins, and mortars ("Mortars"
// there) help it win with more HQ left.
/** Build time after each cleared wave: 90 seconds. */
const DOWNTIME_TICKS = 900;

export const DEFAULT_HORDE_OPTIONS: HordeOptions = {
  firstWaveDelay: 600,
  downtimeTicks: DOWNTIME_TICKS,
  waveCountdown: 300,
  maxWaveTicks: 3_000,
  firstWaveSize: 2_500,
  waveGrowthPercent: 40,
  emittersPerWave: 8,
  emitRate: 200,
  elitesPerWave: 2,
  elitePoints: 20,
  wavesPerDirection: 3,
  minSpawnDistance: 30,
  maxSpawnDistance: 60,
  inlandSpawns: 0,
  maxElites: 500,
  eliteHp: 300,
  shamblerSpeed: 3,
  eliteSpeed: 2,
  elitePressure: 200,
  blockedMagnitude: HORDE_BLOCKED_MAGNITUDE,
  cellCap: 2_000,
  turretRange: HORDE_TURRET_RANGE,
  turretLevelPercent: 50,
  turretHighGroundBonus: 2,
  turretKillsPerTick: 8,
  turretFireInterval: 1,
  hqIncome: 50,
  depotIncome: 0,
  killBounty: 4,
  eliteBounty: 100,
  clearBonusPerWave: 5_000,
  clearedPercent: 2,
  callEarlyGoldPerTick: 100,
  crateInterval: 200,
  crateMax: 3,
  crateMinDistance: 8,
  crateMaxDistance: 25,
  crateLife: 300,
  crateLootTicks: 50,
  crateDangerRadius: 2,
  crateBaseGold: 2_000,
  crateGoldPerWave: 1_500,
  crateLandingRadius: 15,
  crateLandingBonusPercent: 100,
  depotCratePercent: 25,
  depotCrateMax: 4,
  mineRadius: 2,
  mineTrigger: 40,
  mineKills: 600,
  mineEliteDamage: 300,
  mortarRange: 20,
  mortarMinRange: 4,
  mortarReload: 30,
  mortarFlight: 15,
  mortarBlastRadius: 2,
  mortarKills: 600,
  mortarEliteDamage: 150,
  mortarMinTarget: 40,
  mortarLevelPercent: 50,
  baitPull: 30,
  baitActive: 300,
  baitCooldown: 600,
  turretEliteDamage: 20,
  pressureShift: 5,
  structureHp: 3_000,
  wallHp: 4_000,
  stoneWallHp: 12_000,
  reinforcedWallHp: 30_000,
  wallSnapRadius: WALL_SNAP_RADIUS,
  spanCostPerCell: 1_000,
  wallClearRadius: 3,
  repairDelay: 50,
  repairInterval: 10,
  repairHp: 100,
  repairGoldPerHp: 1,
  hqHp: 50_000,
  wavesToWin: 10,
  startingTurrets: 1,
  flowDebounce: 10,
  flowMaxDelay: 50,
  settleInterval: 10,
  settlePercent: 50,
  settleTiles: 20,
  settleCost: 200,
  settleRadius: 14,
  settleRadiusPerWave: 2,
  refugeesPerWave: 10_000,
  outpostRadius: OUTPOST_CLAIM_RADIUS,
  buildingClaimRadius: 3,
  outpostsBase: 1,
  wavesPerOutpost: 2,
};

/** Tile offsets from the HQ tried, in order, for the free turrets. */
const STARTING_TURRET_SPOTS: readonly [number, number][] = [
  [3, 0],
  [0, 3],
  [-3, 0],
  [0, -3],
  [3, 3],
  [-3, 3],
  [-3, -3],
  [3, -3],
];

/** Horde buildings drawn in their cell rather than with a structure icon. */
const CELL_DRAWN_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.Wall,
  UnitType.Mine,
  UnitType.NoiseBeacon,
  UnitType.Depot,
]);

function hasIcon(u: Unit): boolean {
  return !CELL_DRAWN_TYPES.has(u.type());
}

const TARGET_TYPES: readonly UnitType[] = [
  UnitType.City,
  UnitType.DefensePost,
  UnitType.Port,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Factory,
  UnitType.Depot,
  UnitType.Outpost,
];

/** Horde buildings that take up their cell, so no span runs through them. */
const OCCUPYING_TYPES: readonly UnitType[] = [
  ...TARGET_TYPES,
  UnitType.Wall,
  UnitType.Mine,
  UnitType.NoiseBeacon,
];

/**
 * A wall span between two posts, or a post and a mountain. It blocks like a
 * wall and has its own health; when that runs out it is broken (open) until
 * its owner rebuilds it, and it is gone for good once a post at either end
 * falls. One its owner could not yet pay for counts as broken.
 */
interface WallSpan {
  id: number;
  /** The post it was built from, and the post at the far end (-1: mountain). */
  a: number;
  b: number;
  cells: number[];
  damage: number;
  lastHit: number;
  broken: boolean;
}

/** What placing a wall post on a tile would link to, for the build preview. */
export interface WallLinkPreview {
  /** Pairs of tiles: the new post, then the far end of each link. */
  lines: TileRef[];
  cost: bigint;
}

export interface HordeStats {
  wave: number;
  /** Waves survived: cleared, or outlasted until the next one started. */
  wavesSurvived: number;
  alive: number;
  elites: number;
  killed: number;
  structuresDestroyed: number;
  /** Gold paid out for supply crates. */
  crateGold: number;
  /** Shamblers killed by mortar shells (also counted in `killed`). */
  mortarKilled: number;
  /** The first human player's HQ health, or 0 when none is alive. */
  hqHp: number;
  hqsFallen: number;
  /** Wall spans standing, and broken open waiting to be rebuilt. */
  spans: number;
  spansBroken: number;
  outcome: HordeOutcome;
  recomputes: number;
  lastRecomputeMs: number;
  maxRecomputeMs: number;
  totalRecomputeMs: number;
}

export class HordeExecution implements Execution {
  private mg: Game | null = null;
  private opts: HordeOptions;
  private random!: PseudoRandom;
  private width = 0;
  private height = 0;
  private field!: HordeField;
  private hordeFlow!: FlowField;
  private elites!: Elites;
  private spawnCells!: Int32Array;
  /** The disc within base turret range, nearest cells first. */
  private turretOffsets!: Int32Array;
  /** The disc within the longest turret range, and each cell's distance squared. */
  private turretReach!: Int32Array;
  private turretReachD2!: Int32Array;
  /** The disc a mine watches, nearest cells first. */
  private mineReach!: Int32Array;
  /** Terrain movement cost; the live cost adds structure cells on top. */
  private terrainCost!: Uint8Array;
  private director!: WaveDirector;
  private crates!: Crates;
  private mortars!: Mortars;

  private wave = 0;
  private wavesSurvived = 0;
  /** Outposts (tile and owner smallID) at the last claim pass. */
  private outpostTiles: TileRef[] = [];
  private outpostOwners: number[] = [];
  /** The wave under way (or last started), and the one announced next. */
  private currentPlan: WavePlan | null = null;
  private nextPlan: WavePlan | null = null;
  /**
   * When the next wave starts: NOT_STARTED before the first tick, and
   * WAITING_FOR_CLEAR while the wave under way holds up the downtime.
   */
  private nextWaveTick = NOT_STARTED;
  /** When the downtime ends and the countdown begins (-1 outside a break). */
  private downtimeEndTick = -1;
  /** When the wave under way started, for maxWaveTicks. */
  private waveStartTick = -1;
  private ticks = 0;
  private emitterCells: number[] = [];
  private emitterRemaining: number[] = [];
  /** Where the announced wave comes ashore, picked when it is announced. */
  private nextLandings: number[] = [];

  private hordeStructureSig = -1;
  private hordeStructureAt = new Map<number, Unit>();
  private hordeTurrets: Unit[] = [];
  // Cosmetic: [turret cell, target cell] pairs for the turrets that hit
  // something on the last tick. Not part of the simulation state.
  private hordeTurretShots: number[] = [];
  private hordeMortars: Unit[] = [];
  // Cosmetic: cells where mortar shells landed on the last tick.
  private hordeBlasts: number[] = [];
  private hordeHqAt = new Map<number, Player>();
  /** Spans in the order they were built. */
  private spans: WallSpan[] = [];
  private nextSpanId = 1;
  /** Wall posts (by unit id) that have made their links. */
  private linkedWalls = new Set<number>();
  /** Standing span cells from the latest scan. */
  private hordeSpanAt = new Map<number, WallSpan>();
  /** Damage taken by unit id, and the tick each was last attacked. */
  private damage = new Map<number, number>();
  private lastHit = new Map<number, number>();
  /** HQ health by player smallID. */
  private hqHp = new Map<number, number>();
  private hqsFallen = 0;
  private outcome: HordeOutcome = "playing";

  /** Target cells (structures and HQs) from the latest scan. */
  private hordeTargetCells: number[] = [];
  /** Wall cells from the latest scan: obstacles, but not targets. */
  private hordeWallCells: number[] = [];
  /** Cells of beacons sounding at the latest scan: targets with a head start. */
  private hordeBaitCells: number[] = [];
  /** The tick each noise beacon (by unit id) was first seen built. */
  private beaconSince = new Map<number, number>();
  /** Target cells the flow field was last computed from; null before the first. */
  private flowCells: number[] | null = null;
  private flowWalls: number[] = [];
  private flowBait: number[] = [];
  /** Ticks of the latest and the first structure change since the last recompute. */
  private lastChangeTick = -1;
  private firstPendingTick = -1;
  /** Set on restore: the obstacle map must be rebuilt without counting as a change. */
  private hordeObstaclesStale = false;

  private killed = 0;
  private structuresDestroyed = 0;
  // Wall-clock timings for the perf harness. Never read by the simulation.
  private hordeProfile = newProfile();

  constructor(options: Partial<HordeOptions> = {}) {
    this.opts = { ...DEFAULT_HORDE_OPTIONS, ...options };
  }

  init(mg: Game): void {
    this.setup(mg, this.opts, new PseudoRandom(simpleHash("zfront-horde")));
  }

  private setup(mg: Game, opts: HordeOptions, random: PseudoRandom): void {
    this.mg = mg;
    this.opts = opts;
    this.random = random;
    const mini = mg.miniMap();
    this.width = mini.width();
    this.height = mini.height();
    this.terrainCost = buildCostField(mini, opts.blockedMagnitude);
    // Shared by the field and the flow field; scanStructures() makes sure
    // structure cells are enterable even on blocked terrain, so the horde
    // can reach (and press on) a city or HQ in the mountains.
    const cost = this.terrainCost.slice();
    this.field = new HordeField(this.width, this.height, cost, opts.cellCap);
    this.hordeFlow = new FlowField(this.width, this.height, cost);
    this.elites = new Elites(
      opts.maxElites,
      opts.eliteSpeed,
      opts.elitePressure,
    );
    this.spawnCells = spawnableCells(
      mg,
      this.terrainCost,
      this.width,
      this.height,
      opts.inlandSpawns !== 0,
    );
    this.turretOffsets = discOffsets(opts.turretRange, this.width).offsets;
    const reach = discOffsets(
      opts.turretRange + 3 * opts.turretHighGroundBonus,
      this.width,
    );
    this.turretReach = reach.offsets;
    this.turretReachD2 = reach.d2;
    this.mineReach = discOffsets(opts.mineRadius, this.width).offsets;
    this.director = new WaveDirector(opts, this.width);
    // Its own PRNG, so drops don't change the waves' draws.
    this.crates = new Crates(
      opts,
      new PseudoRandom(simpleHash("zfront-crates")),
      this.width,
    );
    this.mortars = new Mortars(opts, this.width, this.height);
    this.hordeStructureAt = new Map();
    this.hordeTurrets = [];
    this.hordeMortars = [];
    this.hordeHqAt = new Map();
    this.hordeSpanAt = new Map();
    this.damage = new Map();
    this.lastHit = new Map();
    this.beaconSince = new Map();
    this.hqHp = new Map();
    this.emitterCells = [];
    this.emitterRemaining = [];
    this.nextLandings = [];
    HORDES.set(mg, this);
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    // A won game keeps going (the result screen's "Keep playing"): waves
    // carry on past wavesToWin. Only a lost one stops.
    if (this.mg === null || this.outcome === "lost") return;
    this.ticks = ticks;
    if (this.nextWaveTick === NOT_STARTED) {
      // The first break: firstWaveDelay in all, ending with the countdown.
      this.nextWaveTick = ticks + this.opts.firstWaveDelay;
      this.downtimeEndTick = Math.max(
        ticks,
        this.nextWaveTick - this.opts.waveCountdown,
      );
      this.buildStartingTurrets();
    }
    this.scanStructures(ticks);
    this.planNextWave();
    if (
      this.nextWaveTick === WAITING_FOR_CLEAR &&
      this.opts.maxWaveTicks > 0 &&
      ticks - this.waveStartTick >= this.opts.maxWaveTicks
    ) {
      this.startBreak();
    }
    if (this.nextWaveTick !== WAITING_FOR_CLEAR && ticks >= this.nextWaveTick) {
      if (this.allWavesStarted()) {
        // Victory. Play on: a downtime, then waves without end.
        this.win();
        this.startBreak();
        this.planNextWave();
      } else {
        this.startWave();
        this.nextWaveTick = WAITING_FOR_CLEAR;
        this.downtimeEndTick = -1;
        this.waveStartTick = ticks;
        this.planNextWave();
      }
    }
    payHqIncome(this.mg!, this.opts);
    this.emit();
    if (ticks % this.opts.shamblerSpeed === 0) {
      this.field.step(this.hordeFlow.dist);
    }
    this.elites.step(this.field, this.hordeFlow.dist);
    this.fireMines();
    if (ticks % this.opts.turretFireInterval === 0) this.fireTurrets();
    else this.hordeTurretShots = [];
    this.fireMortars();
    this.applyPressure();
    if (ticks % this.opts.repairInterval === 0) this.repair();
    this.checkCleared();
    this.tickCrates(ticks);
    this.mg!.setOutpostLimit(outpostLimit(this.opts, this.wavesSurvived));
    if (ticks % this.opts.settleInterval === 0) {
      this.claimAll();
      this.settleAll();
    }
  }

  private tickCrates(ticks: number): void {
    const density = this.field.density;
    const elites = new Set(this.elites.cell.subarray(0, this.elites.count));
    this.crates.tick(this.mg!, ticks, {
      width: this.width,
      height: this.height,
      cellOf: (t) => this.cellOf(t),
      passable: (c) => this.terrainCost[c] !== 0,
      occupied: (c) => density[c] !== 0 || elites.has(c),
      landings: this.nextLandings,
      wave: this.wave,
    });
  }

  /**
   * `player` starts looting supply crate `id` (Crates.loot). Returns false
   * when it can't.
   */
  lootCrate(player: Player, id: number): boolean {
    if (this.mg === null || this.outcome === "lost") return false;
    return this.crates.loot(player, id, this.ticks);
  }

  stats(): HordeStats {
    return {
      wave: this.wave,
      wavesSurvived: this.wavesSurvived,
      alive: this.field?.total() ?? 0,
      elites: this.elites?.count ?? 0,
      killed: this.killed,
      structuresDestroyed: this.structuresDestroyed,
      crateGold: this.crates?.paid() ?? 0,
      mortarKilled: this.mortars?.kills() ?? 0,
      hqHp: this.firstHqHp(),
      hqsFallen: this.hqsFallen,
      spans: this.spans.filter((s) => !s.broken).length,
      spansBroken: this.spans.filter((s) => s.broken).length,
      outcome: this.outcome,
      ...this.hordeProfile,
    };
  }

  /** Points in the wave under way (or last started), 0 before the first. */
  currentWaveBudget(): number {
    return this.currentPlan?.budget ?? 0;
  }

  /** The wave announced next, or null when none is left. */
  upcomingWave(): WavePlan | null {
    return this.nextPlan;
  }

  /** Coarse cells where the announced wave comes ashore. Do not mutate. */
  upcomingLandings(): readonly number[] {
    return this.nextLandings;
  }

  /**
   * Ticks of break that calling the next wave now would skip, or 0 when it
   * can't be called: only between waves, once the last one is cleared (or
   * before the first), and only while one is announced.
   */
  callableTicks(): number {
    if (this.mg === null || this.outcome === "lost") return 0;
    if (this.nextPlan === null || this.wavesSurvived < this.wave) return 0;
    return Math.max(0, this.nextWaveTick - this.ticks);
  }

  /**
   * `caller` calls the announced wave now. Every survivor gets the early
   * call bonus for the break skipped. Returns false when it can't be called
   * (see callableTicks) or the caller is not a human still standing.
   */
  callWave(caller: Player): boolean {
    const skipped = this.callableTicks();
    if (skipped <= 0) return false;
    if (caller.type() !== PlayerType.Human || !caller.isAlive()) return false;
    payCallEarlyBonus(this.mg!, this.opts, this.nextPlan!.wave, skipped);
    this.nextWaveTick = this.ticks;
    this.downtimeEndTick = this.ticks;
    return true;
  }

  /** The supply crates on the map, for tests and tools. Do not mutate. */
  supplyCrates(): readonly Crate[] {
    return this.crates?.all() ?? [];
  }

  /** Density per coarse cell, for rendering and tests. Do not mutate. */
  density(): Uint16Array {
    return this.field.density;
  }

  /**
   * The renderer's view of the horde, in a fresh buffer the worker can
   * transfer. Timing fields are filled in by the worker. Null until init,
   * which waits for the spawn phase to end.
   */
  encodeFrame(): HordeFrame | null {
    if (this.mg === null) return null;
    const d = this.field.density;
    const cells = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (v !== 0) cells[i] = hordeDensityByte(v);
    }
    for (const u of this.mg.units(UnitType.Depot)) {
      cells[this.cellOf(u.tile())] = BYTE_DEPOT;
    }
    for (const u of this.mg.units(UnitType.Mine)) {
      cells[this.cellOf(u.tile())] = BYTE_MINE;
    }
    const sounding = new Set(this.hordeBaitCells);
    for (const u of this.mg.units(UnitType.NoiseBeacon)) {
      const c = this.cellOf(u.tile());
      cells[c] = sounding.has(c) ? BYTE_BEACON_SOUNDING : BYTE_BEACON;
    }
    for (const c of this.hordeWallCells) {
      const span = this.hordeSpanAt.get(c);
      const level =
        span !== undefined
          ? this.spanTier(span)
          : (this.hordeStructureAt.get(c)?.level() ?? 1);
      cells[c] = 251 + Math.min(3, Math.max(1, level));
    }
    for (let k = 0; k < this.elites.count; k++) {
      cells[this.elites.cell[k]] = 255;
    }
    const next = this.nextPlan;
    return {
      width: this.width,
      height: this.height,
      cells,
      alive: this.field.total(),
      elites: this.elites.count,
      wave: this.wave,
      wavesToWin: this.opts.wavesToWin,
      killed: this.killed,
      structuresDestroyed: this.structuresDestroyed,
      outcome: this.outcome,
      hqHp: this.firstHqHp(),
      hqMaxHp: this.opts.hqHp,
      nextWaveIn:
        this.outcome !== "lost" && this.nextWaveTick >= 0
          ? Math.max(0, this.nextWaveTick - this.ticks)
          : -1,
      clearing:
        this.outcome !== "lost" && this.nextWaveTick === WAITING_FOR_CLEAR,
      clearLeft: this.clearLeft(),
      downtimeIn:
        this.outcome !== "lost" && this.downtimeEndTick >= 0
          ? Math.max(0, this.downtimeEndTick - this.ticks)
          : 0,
      nextWave: next?.wave ?? 0,
      nextWaveShamblers: next?.shamblers ?? 0,
      nextWaveElites: next?.elites ?? 0,
      nextWaveSectors: next?.sectors ?? 0,
      nextWaveFinal: next?.final ?? false,
      nextWaveLandings: Int32Array.from(this.nextLandings),
      hqCell: this.firstHqCell(),
      hqTile: this.firstHqTile(),
      settleRadius: passiveRadius(this.opts, this.wavesSurvived),
      turretShots: Int32Array.from(this.hordeTurretShots),
      structureHp: this.encodeStructureHp(),
      mortarShells: this.encodeShells(),
      mortarBlasts: Int32Array.from(this.hordeBlasts),
      mortarBlastRadius: this.opts.mortarBlastRadius,
      callWaveGold: this.callableTicks() * this.opts.callEarlyGoldPerTick,
      canCallWave: this.callableTicks() > 0,
      crates: this.encodeCrates(),
      crateLootTicks: this.opts.crateLootTicks,
      crateLife: this.opts.crateLife,
      encodeMs: 0,
      sentAt: 0,
    };
  }

  /** Four ints per damaged structure: see HordeFrame.structureHp. */
  private encodeStructureHp(): Int32Array {
    const out: number[] = [];
    for (const [id, damage] of this.damage) {
      const u = this.mg!.unit(id);
      if (u === undefined || !u.isActive()) continue;
      const max = this.maxHp(u);
      const icon = hasIcon(u);
      // A cell-drawn building's bar sits over its cell, not its tile.
      const tile = icon ? u.tile() : this.tileOfCell(this.cellOf(u.tile()));
      out.push(tile, Math.max(0, max - damage), max, icon ? 1 : 0);
    }
    for (const s of this.spans) {
      if (s.broken || s.damage === 0 || s.cells.length === 0) continue;
      const max = this.spanMaxHp(s);
      const mid = s.cells[s.cells.length >> 1];
      out.push(this.tileOfCell(mid), Math.max(0, max - s.damage), max, 0);
    }
    return Int32Array.from(out);
  }

  /** The tile at a coarse cell's top-left corner. */
  private tileOfCell(cell: number): TileRef {
    const x = cell % this.width;
    const y = (cell - x) / this.width;
    const map = this.mg!.map();
    return map.ref(
      Math.min(map.width() - 1, x * 2),
      Math.min(map.height() - 1, y * 2),
    );
  }

  /** Four ints per shell: see HordeFrame.mortarShells. */
  private encodeShells(): Int32Array {
    const shells = this.mortars.inFlight();
    const out = new Int32Array(shells.length * 4);
    const flight = Math.max(1, this.opts.mortarFlight);
    shells.forEach((s, k) => {
      out.set(
        [s.from, s.target, Math.max(0, s.lands - this.ticks), flight],
        k * 4,
      );
    });
    return out;
  }

  /** Five ints per crate: see HordeFrame.crates. */
  private encodeCrates(): Int32Array {
    const crates = this.crates.all();
    const out = new Int32Array(crates.length * CRATE_STRIDE);
    crates.forEach((c, k) => {
      out.set(
        [
          c.id,
          c.tile,
          c.gold,
          Math.max(0, c.expires - this.ticks),
          c.lootEnd < 0 ? -1 : Math.max(0, c.lootEnd - this.ticks),
        ],
        k * CRATE_STRIDE,
      );
    });
    return out;
  }

  /** FNV-1a over every piece of horde state that drives the simulation. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h = Math.imul(h ^ (v | 0), 16777619);
    };
    const d = this.field.density;
    for (let i = 0; i < d.length; i++) {
      if (d[i] !== 0) {
        mix(i);
        mix(d[i]);
      }
    }
    for (let k = 0; k < this.elites.count; k++) {
      mix(this.elites.cell[k]);
      mix(this.elites.hp[k]);
    }
    mix(this.wave);
    mix(this.wavesSurvived);
    for (const plan of [this.currentPlan, this.nextPlan]) {
      if (plan === null) continue;
      mix(plan.wave);
      mix(plan.budget);
      mix(plan.sectors);
    }
    for (const c of this.nextLandings) mix(c);
    mix(this.nextWaveTick);
    mix(this.killed);
    mix(this.structuresDestroyed);
    mix(OUTCOMES.indexOf(this.outcome));
    for (const [id, hp] of this.hqHp) {
      mix(id);
      mix(hp);
    }
    for (const [id, dmg] of this.damage) {
      mix(id);
      mix(dmg);
    }
    for (const [id, since] of this.beaconSince) {
      mix(id);
      mix(since);
    }
    for (const s of this.spans) {
      mix(s.id);
      mix(s.a);
      mix(s.b);
      mix(s.cells.length);
      mix(s.damage);
      mix(s.broken ? 1 : 0);
    }
    this.crates.hash(mix);
    this.mortars.hash(mix);
    return h >>> 0;
  }

  /** The first human HQ's coarse cell, or -1. */
  private firstHqCell(): number {
    for (const cell of this.hordeHqAt.keys()) return cell;
    return -1;
  }

  private firstHqTile(): number {
    for (const p of this.hordeHqAt.values()) return p.spawnTile() ?? -1;
    return -1;
  }

  private firstHqHp(): number {
    for (const p of this.hordeHqAt.values()) {
      return this.hqHp.get(p.smallID()) ?? this.opts.hqHp;
    }
    return 0;
  }

  private cellOf(tile: TileRef): number {
    const map = this.mg!.map();
    const x = Math.min(this.width - 1, map.x(tile) >> 1);
    const y = Math.min(this.height - 1, map.y(tile) >> 1);
    return y * this.width + x;
  }

  /**
   * Builds `startingTurrets` finished turrets for free next to each human
   * HQ, so there's something to fight the first wave with before the
   * player can afford one. They go a few tiles out, off the HQ's own
   * coarse cell, so the horde presses on the HQ and not the turret.
   */
  private buildStartingTurrets(): void {
    const mg = this.mg!;
    const map = mg.map();
    for (const p of mg.players()) {
      const hq = p.spawnTile();
      if (p.type() !== PlayerType.Human || !p.isAlive() || hq === undefined) {
        continue;
      }
      const hqCell = this.cellOf(hq);
      let built = 0;
      for (const [dx, dy] of STARTING_TURRET_SPOTS) {
        if (built >= this.opts.startingTurrets) break;
        const x = map.x(hq) + dx;
        const y = map.y(hq) + dy;
        if (!map.isValidCoord(x, y)) continue;
        // Lend the player the price so canBuild passes; buildUnit takes it
        // back.
        const cost = mg.unitInfo(UnitType.DefensePost).cost(mg, p);
        p.addGold(cost);
        const tile = p.canBuild(UnitType.DefensePost, map.ref(x, y));
        if (tile === false || this.cellOf(tile) === hqCell) {
          p.removeGold(cost);
          continue;
        }
        const turret = p.buildUnit(UnitType.DefensePost, tile, {});
        mg.addExecution(new DefensePostExecution(turret));
        built++;
      }
    }
  }

  /**
   * Runs every tick. The obstacle map is rebuilt as soon as the structure set
   * changes, so new structures block the horde at once. The flow field (the
   * expensive part) is debounced: it is recomputed once the set has been
   * stable for `flowDebounce` ticks, or `flowMaxDelay` ticks after the first
   * change, whichever comes first. The first computation is immediate.
   *
   * Snapshots carry the cells the flow field was computed from and the
   * pending change ticks, so a restored game recomputes exactly when the
   * original does.
   */
  private scanStructures(ticks: number): void {
    const units = this.mg!.units(TARGET_TYPES);
    const walls = this.mg!.units(UnitType.Wall);
    this.linkWalls(walls);
    const bait = this.soundingBeacons(ticks);
    // Each human player's spawn tile is their HQ: always a target, and an
    // obstacle the horde presses on. When it falls the player loses.
    const hqs: TileRef[] = [];
    const hqOwners: Player[] = [];
    for (const p of this.mg!.players()) {
      const spawn = p.spawnTile();
      if (p.type() === PlayerType.Human && p.isAlive() && spawn !== undefined) {
        hqs.push(spawn);
        hqOwners.push(p);
      }
    }
    let sig = 0x811c9dc5;
    for (const u of units) {
      sig = Math.imul(sig ^ u.tile(), 16777619);
    }
    for (const t of hqs) {
      sig = Math.imul(sig ^ t, 16777619);
    }
    sig = Math.imul(sig ^ (units.length + hqs.length), 16777619);
    for (const u of walls) {
      sig = Math.imul(sig ^ u.tile(), 16777619);
    }
    sig = Math.imul(sig ^ walls.length, 16777619);
    for (const u of bait) {
      sig = Math.imul(sig ^ u.tile(), 16777619);
    }
    sig = Math.imul(sig ^ bait.length, 16777619);
    for (const s of this.spans) {
      sig = Math.imul(sig ^ (s.broken ? -s.id : s.id), 16777619);
    }
    sig = Math.imul(sig ^ this.spans.length, 16777619) >>> 0;
    const changed = sig !== this.hordeStructureSig;
    if (changed || this.hordeObstaclesStale) {
      this.rebuildObstacles(units, walls, bait, hqs, hqOwners);
      this.hordeObstaclesStale = false;
    }
    if (changed) {
      this.hordeStructureSig = sig;
      this.lastChangeTick = ticks;
      if (this.firstPendingTick < 0) this.firstPendingTick = ticks;
    }
    if (this.firstPendingTick < 0) return;
    if (
      this.flowCells === null ||
      ticks - this.lastChangeTick >= this.opts.flowDebounce ||
      ticks - this.firstPendingTick >= this.opts.flowMaxDelay
    ) {
      this.computeFlow(
        this.hordeTargetCells,
        this.hordeWallCells,
        this.hordeBaitCells,
      );
      this.firstPendingTick = -1;
    }
  }

  /**
   * Finished noise beacons that are sounding at `ticks`. Each one's cycle
   * starts when it is first seen built; beacons that are gone are forgotten.
   */
  private soundingBeacons(ticks: number): Unit[] {
    const sounding: Unit[] = [];
    const seen = new Set<number>();
    for (const u of this.mg!.units(UnitType.NoiseBeacon)) {
      if (u.isUnderConstruction()) continue;
      seen.add(u.id());
      let since = this.beaconSince.get(u.id());
      if (since === undefined) {
        since = ticks;
        this.beaconSince.set(u.id(), ticks);
      }
      if (beaconSounding(this.opts, since, ticks)) sounding.push(u);
    }
    for (const id of [...this.beaconSince.keys()]) {
      if (!seen.has(id)) this.beaconSince.delete(id);
    }
    return sounding;
  }

  private rebuildObstacles(
    units: readonly Unit[],
    walls: readonly Unit[],
    bait: readonly Unit[],
    hqs: readonly TileRef[],
    hqOwners: readonly Player[],
  ): void {
    const obstacle = this.field.obstacle;
    obstacle.fill(0);
    this.hordeStructureAt.clear();
    this.hordeTurrets = [];
    this.hordeMortars = [];
    const cells: number[] = [];
    for (const u of units) {
      const cell = this.cellOf(u.tile());
      if (obstacle[cell] === 0) {
        obstacle[cell] = 1;
        cells.push(cell);
        this.hordeStructureAt.set(cell, u);
      }
      if (u.type() === UnitType.DefensePost) this.hordeTurrets.push(u);
      if (u.type() === UnitType.MissileSilo) this.hordeMortars.push(u);
    }
    this.hordeHqAt.clear();
    hqs.forEach((t, k) => {
      const cell = this.cellOf(t);
      if (obstacle[cell] === 0) {
        obstacle[cell] = 1;
        cells.push(cell);
      }
      if (!this.hordeHqAt.has(cell)) this.hordeHqAt.set(cell, hqOwners[k]);
    });
    this.hordeTargetCells = cells;
    // A sounding beacon is a target the horde presses on, with a head start.
    const baitCells: number[] = [];
    for (const u of bait) {
      const cell = this.cellOf(u.tile());
      if (obstacle[cell] !== 0) continue;
      obstacle[cell] = 1;
      baitCells.push(cell);
      this.hordeStructureAt.set(cell, u);
    }
    this.hordeBaitCells = baitCells;
    // Walls last: a cell already holding a target stays a target.
    const wallCells: number[] = [];
    for (const u of walls) {
      const cell = this.cellOf(u.tile());
      if (obstacle[cell] !== 0) continue;
      obstacle[cell] = 1;
      wallCells.push(cell);
      this.hordeStructureAt.set(cell, u);
    }
    // Then the spans between them.
    this.hordeSpanAt.clear();
    for (const s of this.spans) {
      if (s.broken) continue;
      for (const cell of s.cells) {
        if (obstacle[cell] !== 0) continue;
        obstacle[cell] = 1;
        wallCells.push(cell);
        this.hordeSpanAt.set(cell, s);
      }
    }
    this.hordeWallCells = wallCells;
  }

  /**
   * Drops the spans of posts that are gone, then links each new post, in
   * unit order. A span the owner can't afford yet, or with the horde too
   * close, starts out unbuilt, like a broken one, and goes up as soon as it
   * can (see repairSpans).
   */
  private linkWalls(walls: readonly Unit[]): void {
    const alive = new Set<number>();
    for (const u of walls) alive.add(u.id());
    this.spans = this.spans.filter(
      (s) => alive.has(s.a) && (s.b < 0 || alive.has(s.b)),
    );
    for (const id of [...this.linkedWalls]) {
      if (!alive.has(id)) this.linkedWalls.delete(id);
    }
    for (const u of walls) {
      if (this.linkedWalls.has(u.id())) continue;
      this.linkedWalls.add(u.id());
      const owner = u.owner();
      for (const link of this.planLinks(owner, u.tile(), walls)) {
        const cost = BigInt(link.cells.length * this.opts.spanCostPerCell);
        const paid = owner.gold() >= cost && !this.hordeNearCells(link.cells);
        if (paid) owner.removeGold(cost);
        this.spans.push({
          id: this.nextSpanId++,
          a: u.id(),
          b: link.post,
          cells: link.cells,
          damage: 0,
          lastHit: paid ? this.ticks : this.ticks - this.opts.repairDelay,
          broken: !paid,
        });
      }
    }
  }

  /** The links a post of `owner`'s on `tile` would make to `walls`. */
  private planLinks(
    owner: Player,
    tile: TileRef,
    walls: readonly Unit[],
  ): WallLink[] {
    const mg = this.mg!;
    const map = mg.map();
    const mini = mg.miniMap();
    const w = this.width;
    const cell = this.cellOf(tile);
    const posts: LinkPost[] = [];
    for (const u of walls) {
      if (u.owner() !== owner || u.tile() === tile) continue;
      posts.push({ cell: this.cellOf(u.tile()), id: u.id() });
    }
    const occupied = new Set<number>();
    for (const u of mg.units(OCCUPYING_TYPES))
      occupied.add(this.cellOf(u.tile()));
    for (const p of mg.players()) {
      const spawn = p.spawnTile();
      if (p.type() === PlayerType.Human && spawn !== undefined) {
        occupied.add(this.cellOf(spawn));
      }
    }
    for (const s of this.spans) for (const c of s.cells) occupied.add(c);
    const terrain = this.terrainCost;
    const grid: LinkGrid = {
      width: w,
      height: this.height,
      isMountain: (c) => {
        if (terrain[c] !== 0 || occupied.has(c)) return false;
        const x = c % w;
        return mini.isLand(mini.ref(x, (c - x) / w));
      },
      spannable: (c) => {
        if (terrain[c] === 0 || occupied.has(c)) return false;
        const x = c % w;
        const t = map.ref(
          Math.min(map.width() - 1, x * 2),
          Math.min(map.height() - 1, ((c - x) / w) * 2),
        );
        return mg.owner(t) === owner;
      },
    };
    return chooseLinks(cell, posts, grid, this.opts.wallSnapRadius);
  }

  /**
   * What a new wall post of `owner`'s on `tile` would link to now, and what
   * the spans would cost, for the build preview.
   */
  previewWallLinks(owner: Player, tile: TileRef): WallLinkPreview {
    const lines: TileRef[] = [];
    let cells = 0;
    if (this.mg === null) return { lines, cost: 0n };
    const map = this.mg.map();
    const w = this.width;
    for (const link of this.planLinks(
      owner,
      tile,
      this.mg.units(UnitType.Wall),
    )) {
      const x = link.anchor % w;
      lines.push(
        tile,
        map.ref(
          Math.min(map.width() - 1, x * 2),
          Math.min(map.height() - 1, ((link.anchor - x) / w) * 2),
        ),
      );
      cells += link.cells.length;
    }
    return { lines, cost: BigInt(cells * this.opts.spanCostPerCell) };
  }

  /**
   * Whether any of the horde (or an elite) is within `wallClearRadius`
   * coarse cells of `tile`'s cell, so no wall can go up there.
   */
  hordeNear(tile: TileRef): boolean {
    if (this.mg === null) return false;
    return this.hordeNearCells([this.cellOf(tile)]);
  }

  private hordeNearCells(cells: readonly number[]): boolean {
    const r = Math.max(0, this.opts.wallClearRadius);
    const w = this.width;
    const h = this.height;
    const density = this.field.density;
    for (const c of cells) {
      const cx = c % w;
      const cy = (c - cx) / w;
      for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
          if (density[y * w + x] !== 0) return true;
        }
      }
      for (let k = 0; k < this.elites.count; k++) {
        const e = this.elites.cell[k];
        const ex = e % w;
        if (Math.abs(ex - cx) <= r && Math.abs((e - ex) / w - cy) <= r) {
          return true;
        }
      }
    }
    return false;
  }

  /** Whether a span (standing or broken) runs through `tile`'s cell. */
  isSpanCell(tile: TileRef): boolean {
    if (this.mg === null) return false;
    const cell = this.cellOf(tile);
    return this.spans.some((s) => s.cells.includes(cell));
  }

  /** A span's tier: that of the weaker post at its ends. */
  private spanTier(s: WallSpan): number {
    const level = (id: number) => this.mg!.unit(id)?.level() ?? 1;
    const tier = s.b < 0 ? level(s.a) : Math.min(level(s.a), level(s.b));
    return Math.min(3, Math.max(1, tier));
  }

  private spanMaxHp(s: WallSpan): number {
    const o = this.opts;
    return [o.wallHp, o.stoneWallHp, o.reinforcedWallHp][this.spanTier(s) - 1];
  }

  /**
   * Recomputes the flow field toward `cells`, which become enterable. Wall
   * cells (on walkable terrain) get WALL_COST, so the flow goes round them
   * unless there is no other way in.
   */
  private computeFlow(
    cells: readonly number[],
    walls: readonly number[],
    bait: readonly number[],
  ): void {
    const cost = this.hordeFlow.cost;
    cost.set(this.terrainCost);
    for (const c of walls) {
      if (cost[c] !== 0) cost[c] = WALL_COST;
    }
    for (const c of [...cells, ...bait]) {
      if (cost[c] === 0) cost[c] = 1;
    }
    // Ordinary targets start `baitPull` cells behind sounding beacons.
    const pull = bait.length > 0 ? this.opts.baitPull * ORTHO_STEP : 0;
    const starts = [...cells.map(() => pull), ...bait.map(() => 0)];
    const start = performance.now();
    this.hordeFlow.compute([...cells, ...bait], starts);
    this.flowCells = [...cells];
    this.flowWalls = [...walls];
    this.flowBait = [...bait];
    const ms = performance.now() - start;
    const prof = this.hordeProfile;
    prof.recomputes++;
    prof.lastRecomputeMs = ms;
    prof.totalRecomputeMs += ms;
    if (ms > prof.maxRecomputeMs) prof.maxRecomputeMs = ms;
  }

  /** The last wave to win has started (false once won: waves go on). */
  private allWavesStarted(): boolean {
    return (
      this.outcome === "playing" &&
      this.opts.wavesToWin > 0 &&
      this.wave >= this.opts.wavesToWin
    );
  }

  /** Plans (and so announces) the next wave once the last one has started. */
  private planNextWave(): void {
    if (this.nextPlan !== null || this.allWavesStarted()) return;
    this.surveySpawns();
    const plan = this.director.plan(this.currentPlan, this.random);
    this.nextPlan = plan;
    this.nextLandings = this.director.emitterCells(
      plan,
      this.opts.emittersPerWave,
      this.random,
    );
  }

  /** Sorts spawn cells by direction around the first HQ (or the map centre). */
  private surveySpawns(): void {
    let centre = (this.height >> 1) * this.width + (this.width >> 1);
    for (const cell of this.hordeHqAt.keys()) {
      centre = cell;
      break;
    }
    this.director.survey(this.spawnCells, centre, this.hordeFlow.dist);
  }

  private startWave(): void {
    const plan = this.nextPlan;
    if (plan === null) return;
    this.nextPlan = null;
    // Still standing when the next wave starts: the last one counts as survived.
    this.survived(this.wave);
    this.currentPlan = plan;
    this.wave = plan.wave;
    this.surveySpawns();
    // Landings are picked when the wave is announced; a game restored from
    // before that (version 7) picks them now.
    const cells =
      this.nextLandings.length > 0
        ? this.nextLandings
        : this.director.emitterCells(
            plan,
            this.opts.emittersPerWave,
            this.random,
          );
    this.nextLandings = [];
    if (cells.length === 0) return;
    const n = cells.length;
    const share = Math.floor(plan.shamblers / n);
    cells.forEach((cell, j) => {
      this.emitterCells.push(cell);
      this.emitterRemaining.push(
        j === 0 ? share + (plan.shamblers - share * n) : share,
      );
    });
    const eliteCells = this.director.emitterCells(
      plan,
      plan.elites,
      this.random,
    );
    for (let j = 0; j < plan.elites; j++) {
      this.elites.spawn(eliteCells[j], this.opts.eliteHp);
    }
  }

  /**
   * The wave under way is cleared once it has all spawned and no more than
   * `clearedPercent` of its size is still alive, so a few stragglers stuck
   * on a far shore don't hold it open.
   */
  private checkCleared(): void {
    const plan = this.currentPlan;
    if (plan === null || this.emitterCells.length > 0) return;
    const left = this.field.total() + this.elites.count;
    if (left * 100 <= plan.budget * this.opts.clearedPercent) {
      if (this.wave > this.wavesSurvived) {
        payClearBonus(this.mg!, this.opts, this.wave);
      }
      this.survived(this.wave);
      if (this.nextWaveTick === WAITING_FOR_CLEAR) this.startBreak();
    }
  }

  /**
   * Zombies still to kill (or still to spawn) before the wave under way
   * counts as cleared; 0 when it is cleared or none is under way.
   */
  private clearLeft(): number {
    const plan = this.currentPlan;
    if (plan === null || this.nextWaveTick !== WAITING_FOR_CLEAR) return 0;
    let left = this.field.total() + this.elites.count;
    for (const n of this.emitterRemaining) left += n;
    const allowed = Math.floor((plan.budget * this.opts.clearedPercent) / 100);
    return Math.max(0, left - allowed);
  }

  /**
   * The wave under way is over (cleared, or outlasted for maxWaveTicks):
   * the downtime starts, then the countdown. After the last wave there's
   * nothing to wait for, so the player wins on the next tick.
   */
  private startBreak(): void {
    if (this.allWavesStarted()) {
      this.downtimeEndTick = this.ticks;
      this.nextWaveTick = this.ticks;
      return;
    }
    this.downtimeEndTick = this.ticks + this.opts.downtimeTicks;
    this.nextWaveTick = this.downtimeEndTick + this.opts.waveCountdown;
  }

  private survived(wave: number): void {
    if (wave <= this.wavesSurvived) return;
    this.wavesSurvived = wave;
    welcomeRefugees(this.mg!, this.opts, wave);
  }

  /**
   * Buildings claim land for each human, in player order, after the land of
   * any Outpost lost since the last pass has lapsed.
   */
  private claimAll(): void {
    const mg = this.mg!;
    const live = new Set<TileRef>();
    const humans = mg
      .players()
      .filter((p) => p.type() === PlayerType.Human && p.isAlive());
    for (const p of humans) {
      for (const u of outposts(p)) live.add(u.tile());
    }
    for (let k = 0; k < this.outpostTiles.length; k++) {
      const tile = this.outpostTiles[k];
      if (live.has(tile)) continue;
      const owner = humans.find((p) => p.smallID() === this.outpostOwners[k]);
      if (owner === undefined) continue;
      lapseOutpost(
        mg,
        owner,
        this.opts,
        tile,
        owner.spawnTile(),
        passiveRadius(this.opts, this.wavesSurvived),
      );
    }
    this.outpostTiles = [];
    this.outpostOwners = [];
    for (const p of humans) {
      applyClaims(mg, p, this.opts);
      for (const u of outposts(p)) {
        this.outpostTiles.push(u.tile());
        this.outpostOwners.push(p.smallID());
      }
    }
  }

  /** Settlers claim free land for each human, in player order. */
  private settleAll(): void {
    const mg = this.mg!;
    const covered = new Uint8Array(this.width * this.height);
    const view = {
      cellOf: (t: TileRef) => this.cellOf(t),
      density: this.field.density,
      covered,
    };
    for (const p of mg.players()) {
      if (p.type() !== PlayerType.Human || !p.isAlive()) continue;
      covered.fill(0);
      this.markCover(p, covered);
      settle(mg, p, this.opts, this.wavesSurvived, view);
    }
  }

  private markCover(owner: Player, covered: Uint8Array): void {
    const w = this.width;
    const n = covered.length;
    const offsets = this.turretOffsets;
    for (const t of this.hordeTurrets) {
      if (!t.isActive() || t.owner() !== owner) continue;
      const c = this.cellOf(t.tile());
      const cx = c % w;
      for (let k = 0; k < offsets.length; k += 2) {
        const x = cx + offsets[k];
        const cell = c + offsets[k + 1];
        if (x < 0 || x >= w || cell < 0 || cell >= n) continue;
        covered[cell] = 1;
      }
    }
  }

  private emit(): void {
    let kept = 0;
    for (let j = 0; j < this.emitterCells.length; j++) {
      const cell = this.emitterCells[j];
      let remaining = this.emitterRemaining[j];
      remaining -= this.field.add(
        cell,
        Math.min(this.opts.emitRate, remaining),
      );
      if (remaining > 0) {
        this.emitterCells[kept] = cell;
        this.emitterRemaining[kept] = remaining;
        kept++;
      }
    }
    this.emitterCells.length = kept;
    this.emitterRemaining.length = kept;
  }

  /** Sets off every finished mine with enough of the horde around it. */
  private fireMines(): void {
    for (const u of this.mg!.units(UnitType.Mine)) {
      if (u.isUnderConstruction()) continue;
      const c = this.cellOf(u.tile());
      const hit = detonate(
        this.opts,
        this.field,
        this.elites,
        c,
        this.mineReach,
      );
      if (hit === null) continue;
      this.killed += hit.shamblers;
      payBounty(u.owner(), this.opts, hit.shamblers, hit.elites);
      u.delete(false);
    }
  }

  private fireTurrets(): void {
    const w = this.width;
    const n = w * this.height;
    const offsets = this.turretReach;
    const d2 = this.turretReachD2;
    this.hordeTurretShots = [];
    for (const t of this.hordeTurrets) {
      if (!readyToFire(t)) continue;
      const c = this.cellOf(t.tile());
      const cx = c % w;
      const cy = (c - cx) / w;
      const range = this.turretRangeAt(t.tile());
      const r2 = range * range;
      // Each level above 1 adds turretLevelPercent of the base firepower.
      const power = 100 + (t.level() - 1) * this.opts.turretLevelPercent;
      let budget = Math.floor((this.opts.turretKillsPerTick * power) / 100);
      let shamblers = 0;
      let elites = 0;
      let target = -1;
      for (let k = 0; k < offsets.length && budget > 0; k += 2) {
        if (d2[k >> 1] > r2) break;
        const x = cx + offsets[k];
        const cell = c + offsets[k + 1];
        if (x < 0 || x >= w || cell < 0 || cell >= n) continue;
        const removed = this.field.remove(cell, budget);
        if (removed > 0) target = cell;
        budget -= removed;
        this.killed += removed;
        shamblers += removed;
      }
      // One elite per turret per tick: the first in range.
      for (let e = 0; e < this.elites.count; e++) {
        const ec = this.elites.cell[e];
        const ex = ec % w;
        const ey = (ec - ex) / w;
        const dx = ex - cx;
        const dy = ey - cy;
        if (dx * dx + dy * dy <= r2 && this.elites.hp[e] > 0) {
          this.elites.hp[e] -= Math.floor(
            (this.opts.turretEliteDamage * power) / 100,
          );
          if (this.elites.hp[e] <= 0) elites++;
          target = ec;
          break;
        }
      }
      if (target >= 0) this.hordeTurretShots.push(c, target);
      payBounty(t.owner(), this.opts, shamblers, elites);
    }
    this.killed += this.elites.removeDead();
  }

  /**
   * Lands the shells due this tick, paying each mortar's owner for its
   * kills, then fires every finished mortar that has reloaded.
   */
  private fireMortars(): void {
    const mg = this.mg!;
    this.hordeBlasts = [];
    for (const b of this.mortars.land(this.ticks, this.field, this.elites)) {
      this.killed += b.shamblers;
      this.hordeBlasts.push(b.cell);
      const owner = mg.playerBySmallID(b.owner);
      if (owner.isPlayer()) payBounty(owner, this.opts, b.shamblers, b.elites);
    }
    this.killed += this.elites.removeDead();
    const guns: MortarGun[] = [];
    for (const u of this.hordeMortars) {
      if (!readyToFire(u)) continue;
      guns.push({
        id: u.id(),
        cell: this.cellOf(u.tile()),
        owner: u.owner().smallID(),
        level: u.level(),
      });
    }
    // Aim where the horde will have walked by the time the shell lands.
    const lead = Math.floor(
      this.opts.mortarFlight / Math.max(1, this.opts.shamblerSpeed),
    );
    this.mortars.fire(guns, this.ticks, this.field, this.hordeFlow.dist, lead);
  }

  private applyPressure(): void {
    this.field.drainPressure((cell, pressure) => {
      const span = this.hordeSpanAt.get(cell);
      if (span !== undefined) {
        this.damageSpan(span, pressure);
        return;
      }
      const u = this.hordeStructureAt.get(cell);
      if (u === undefined || !u.isActive()) {
        const owner = this.hordeHqAt.get(cell);
        if (owner !== undefined) this.damageHq(owner, pressure);
        return;
      }
      const id = u.id();
      const damage =
        (this.damage.get(id) ?? 0) + (pressure >> this.opts.pressureShift);
      this.lastHit.set(id, this.ticks);
      if (damage < this.maxHp(u)) {
        this.damage.set(id, damage);
        return;
      }
      this.damage.delete(id);
      this.lastHit.delete(id);
      u.delete(false);
      this.structuresDestroyed++;
    });
  }

  /** A span that runs out of health breaks open; the next scan clears it. */
  private damageSpan(s: WallSpan, pressure: number): void {
    if (s.broken) return;
    s.damage += pressure >> this.opts.pressureShift;
    s.lastHit = this.ticks;
    if (s.damage < this.spanMaxHp(s)) return;
    s.damage = 0;
    s.broken = true;
  }

  /** Full health of a structure: walls by tier, everything else the same. */
  private maxHp(u: Unit): number {
    if (u.type() !== UnitType.Wall) return this.opts.structureHp;
    const o = this.opts;
    const tier = Math.min(3, Math.max(1, u.level()));
    return [o.wallHp, o.stoneWallHp, o.reinforcedWallHp][tier - 1];
  }

  private turretRangeAt(tile: TileRef): number {
    return turretRange(this.opts, this.mg!.map().magnitude(tile));
  }

  /**
   * Structures that haven't been attacked for `repairDelay` ticks get
   * health back, paid for in gold by their owner; repair stops when the
   * owner can't pay. Units that are gone are forgotten.
   */
  private repair(): void {
    const o = this.opts;
    if (o.repairHp <= 0) return;
    this.repairSpans();
    for (const [id, damage] of this.damage) {
      const u = this.mg!.unit(id);
      if (u === undefined || !u.isActive()) {
        this.damage.delete(id);
        this.lastHit.delete(id);
        continue;
      }
      if (this.ticks - (this.lastHit.get(id) ?? 0) < o.repairDelay) continue;
      let heal = Math.min(damage, o.repairHp);
      if (o.repairGoldPerHp > 0) {
        const affordable = u.owner().gold() / BigInt(o.repairGoldPerHp);
        if (affordable < BigInt(heal)) heal = Number(affordable);
        if (heal <= 0) continue;
        u.owner().removeGold(BigInt(heal * o.repairGoldPerHp));
      }
      if (heal >= damage) {
        this.damage.delete(id);
        this.lastHit.delete(id);
      } else {
        this.damage.set(id, damage - heal);
      }
    }
  }

  /**
   * Spans repair like structures. A broken one is rebuilt whole, at its
   * build price, once the horde is `wallClearRadius` cells clear of it.
   */
  private repairSpans(): void {
    const o = this.opts;
    for (const s of this.spans) {
      if (this.ticks - s.lastHit < o.repairDelay) continue;
      const owner = this.mg!.unit(s.a)?.owner();
      if (owner === undefined) continue;
      if (s.broken) {
        const cost = BigInt(s.cells.length * o.spanCostPerCell);
        if (owner.gold() < cost || this.hordeNearCells(s.cells)) continue;
        owner.removeGold(cost);
        s.broken = false;
        continue;
      }
      if (s.damage === 0) continue;
      let heal = Math.min(s.damage, o.repairHp);
      if (o.repairGoldPerHp > 0) {
        const affordable = owner.gold() / BigInt(o.repairGoldPerHp);
        if (affordable < BigInt(heal)) heal = Number(affordable);
        if (heal <= 0) continue;
        owner.removeGold(BigInt(heal * o.repairGoldPerHp));
      }
      s.damage -= heal;
    }
  }

  private damageHq(owner: Player, pressure: number): void {
    const id = owner.smallID();
    const hp =
      (this.hqHp.get(id) ?? this.opts.hqHp) -
      (pressure >> this.opts.pressureShift);
    this.hqHp.set(id, Math.max(0, hp));
    if (hp > 0 || !owner.isAlive()) return;

    // The HQ has fallen: the player loses everything. The next scan drops
    // the HQ as a target; once no human is left the game ends.
    this.hqsFallen++;
    for (const u of owner.units()) u.delete(false);
    for (const t of [...owner.tiles()]) owner.relinquish(t);
    const humansLeft = this.mg!.players().some(
      (p) => p.type() === PlayerType.Human && p.isAlive(),
    );
    // After a win, falling later doesn't take the win away.
    if (!humansLeft && this.outcome === "playing") {
      this.outcome = "lost";
      this.mg!.setWinner(null, this.mg!.stats().stats());
    }
  }

  /** Every wave survived: the first human still standing wins. */
  private win(): void {
    this.outcome = "won";
    const survivor = this.mg!.players().find(
      (p) => p.type() === PlayerType.Human && p.isAlive(),
    );
    this.mg!.setWinner(survivor ?? null, this.mg!.stats().stats());
  }

  snapshot(): ExecRecord {
    const e = this.elites;
    return HordeExecutionSnapshot.write({
      initialized: this.mg !== null,
      options: this.opts,
      random: this.random.getState(),
      wave: this.wave,
      wavesSurvived: this.wavesSurvived,
      outpostTiles: [...this.outpostTiles],
      outpostOwners: [...this.outpostOwners],
      currentPlan: this.currentPlan,
      nextPlan: this.nextPlan,
      nextWaveTick: this.nextWaveTick,
      downtimeEndTick: this.downtimeEndTick,
      waveStartTick: this.waveStartTick,
      ticks: this.ticks,
      density:
        this.mg !== null ? this.field.density.slice() : new Uint16Array(),
      emitterCells: [...this.emitterCells],
      emitterRemaining: [...this.emitterRemaining],
      nextLandings: [...this.nextLandings],
      eliteCells: e ? Array.from(e.cell.subarray(0, e.count)) : [],
      eliteHp: e ? Array.from(e.hp.subarray(0, e.count)) : [],
      eliteCooldown: e ? Array.from(e.cooldown.subarray(0, e.count)) : [],
      damageIds: [...this.damage.keys()],
      damageValues: [...this.damage.values()],
      lastHitIds: [...this.lastHit.keys()],
      lastHitTicks: [...this.lastHit.values()],
      beaconIds: [...this.beaconSince.keys()],
      beaconSince: [...this.beaconSince.values()],
      hqIds: [...this.hqHp.keys()],
      hqValues: [...this.hqHp.values()],
      hqsFallen: this.hqsFallen,
      outcome: OUTCOMES.indexOf(this.outcome),
      structureSig: this.hordeStructureSig,
      flowCells: this.flowCells === null ? null : [...this.flowCells],
      flowWalls: [...this.flowWalls],
      flowBait: [...this.flowBait],
      lastChangeTick: this.lastChangeTick,
      firstPendingTick: this.firstPendingTick,
      killed: this.killed,
      structuresDestroyed: this.structuresDestroyed,
      spanIds: this.spans.map((s) => s.id),
      spanA: this.spans.map((s) => s.a),
      spanB: this.spans.map((s) => s.b),
      spanCellCounts: this.spans.map((s) => s.cells.length),
      spanCells: this.spans.flatMap((s) => s.cells),
      spanDamage: this.spans.map((s) => s.damage),
      spanLastHit: this.spans.map((s) => s.lastHit),
      spanBroken: this.spans.map((s) => s.broken),
      nextSpanId: this.nextSpanId,
      linkedWalls: [...this.linkedWalls],
      crates: this.mg !== null ? this.crates.state() : null,
      mortars: this.mg !== null ? this.mortars.state() : null,
    });
  }

  restoreSnapshot(s: HordeState, r: SnapshotReader): void {
    const opts = { ...DEFAULT_HORDE_OPTIONS, ...s.options };
    this.opts = opts;
    this.mg = null;
    this.wave = s.wave;
    this.wavesSurvived = s.wavesSurvived;
    this.outpostTiles = s.outpostTiles.map((t) => t as TileRef);
    this.outpostOwners = [...s.outpostOwners];
    r.game.setOutpostLimit(outpostLimit(opts, s.wavesSurvived));
    this.currentPlan = s.currentPlan;
    this.nextPlan = s.nextPlan;
    this.nextWaveTick = s.nextWaveTick;
    this.downtimeEndTick = s.downtimeEndTick;
    this.waveStartTick = s.waveStartTick;
    this.ticks = s.ticks;
    this.killed = s.killed;
    this.structuresDestroyed = s.structuresDestroyed;
    this.hqsFallen = s.hqsFallen;
    this.outcome = OUTCOMES[s.outcome];
    this.hordeProfile = newProfile();
    this.hordeStructureSig = s.structureSig;
    this.hordeTargetCells = [];
    this.hordeWallCells = [];
    this.hordeBaitCells = [];
    let at = 0;
    this.spans = s.spanIds.map((id, k) => {
      const n = s.spanCellCounts[k];
      at += n;
      return {
        id,
        a: s.spanA[k],
        b: s.spanB[k],
        cells: s.spanCells.slice(at - n, at),
        damage: s.spanDamage[k],
        lastHit: s.spanLastHit[k],
        broken: s.spanBroken[k],
      };
    });
    this.nextSpanId = s.nextSpanId;
    this.linkedWalls = new Set(s.linkedWalls);
    this.flowCells = null;
    this.flowWalls = [];
    this.flowBait = [];
    this.lastChangeTick = s.lastChangeTick;
    this.firstPendingTick = s.firstPendingTick;
    // Rebuilt on the next scan from the same units the original game has.
    this.hordeObstaclesStale = true;
    if (!s.initialized) {
      this.random = PseudoRandom.fromState(s.random);
      return;
    }
    this.setup(r.game, opts, PseudoRandom.fromState(s.random));
    this.field.setDensity(s.density);
    this.emitterCells = [...s.emitterCells];
    this.emitterRemaining = [...s.emitterRemaining];
    this.nextLandings = [...s.nextLandings];
    for (let k = 0; k < s.eliteCells.length; k++) {
      this.elites.spawn(s.eliteCells[k], s.eliteHp[k]);
      this.elites.cooldown[k] = s.eliteCooldown[k];
    }
    this.damage = new Map(s.damageIds.map((id, i) => [id, s.damageValues[i]]));
    this.lastHit = new Map(
      s.lastHitIds.map((id, i) => [id, s.lastHitTicks[i]]),
    );
    this.hqHp = new Map(s.hqIds.map((id, i) => [id, s.hqValues[i]]));
    this.beaconSince = new Map(
      s.beaconIds.map((id, i) => [id, s.beaconSince[i]]),
    );
    if (s.crates !== null) this.crates.restore(s.crates);
    if (s.mortars !== null) this.mortars.restore(s.mortars);
    if (s.flowCells !== null) {
      this.computeFlow(s.flowCells, s.flowWalls, s.flowBait);
    }
  }
}

/**
 * Turret range in coarse cells for a turret on terrain of height
 * `magnitude`: longer on high ground, up to 3 bonuses on the highest peaks.
 */
export function turretRange(
  opts: Pick<HordeOptions, "turretRange" | "turretHighGroundBonus">,
  magnitude: number,
): number {
  const mag = Math.min(30, Math.max(0, magnitude));
  return opts.turretRange + Math.floor((mag * opts.turretHighGroundBonus) / 10);
}

function newProfile() {
  return {
    recomputes: 0,
    lastRecomputeMs: 0,
    maxRecomputeMs: 0,
    totalRecomputeMs: 0,
  };
}

/**
 * Where waves can rise: land cells on the map edge or next to water, where
 * they come ashore, or with `inland` every open cell.
 */
function spawnableCells(
  mg: Game,
  cost: Uint8Array,
  w: number,
  h: number,
  inland: boolean,
): Int32Array {
  const mini = mg.miniMap();
  const cells: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cost[i] === 0) continue;
      let coastal = inland || x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!coastal) {
        coastal =
          !mini.isLand(mini.ref(x - 1, y)) ||
          !mini.isLand(mini.ref(x + 1, y)) ||
          !mini.isLand(mini.ref(x, y - 1)) ||
          !mini.isLand(mini.ref(x, y + 1));
      }
      if (coastal) cells.push(i);
    }
  }
  return Int32Array.from(cells);
}

/**
 * (dx, cell offset) pairs for every cell within `r`, nearest first and then
 * in row-major order, so turrets always pick targets the same way, with
 * each cell's distance squared.
 */
function discOffsets(
  r: number,
  w: number,
): { offsets: Int32Array; d2: Int32Array } {
  const pts: [number, number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r) pts.push([d2, dy, dx]);
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const offsets = new Int32Array(pts.length * 2);
  const d2 = new Int32Array(pts.length);
  pts.forEach(([dist2, dy, dx], k) => {
    offsets[2 * k] = dx;
    offsets[2 * k + 1] = dy * w + dx;
    d2[k] = dist2;
  });
  return { offsets, d2 };
}

const HordeOptionsSchema = z.object({
  firstWaveDelay: zInt(),
  downtimeTicks: zInt(),
  waveCountdown: zInt(),
  maxWaveTicks: zInt(),
  firstWaveSize: zInt(),
  waveGrowthPercent: zInt(),
  emittersPerWave: zInt(),
  emitRate: zInt(),
  elitesPerWave: zInt(),
  elitePoints: zInt(),
  wavesPerDirection: zInt(),
  minSpawnDistance: zInt(),
  maxSpawnDistance: zInt(),
  inlandSpawns: zInt(),
  maxElites: zInt(),
  eliteHp: zInt(),
  shamblerSpeed: zInt(),
  eliteSpeed: zInt(),
  elitePressure: zInt(),
  blockedMagnitude: zInt(),
  cellCap: zInt(),
  turretRange: zInt(),
  turretLevelPercent: zInt(),
  turretHighGroundBonus: zInt(),
  turretKillsPerTick: zInt(),
  turretFireInterval: zInt(),
  hqIncome: zInt(),
  killBounty: zInt(),
  eliteBounty: zInt(),
  clearBonusPerWave: zInt(),
  clearedPercent: zInt(),
  callEarlyGoldPerTick: zInt(),
  depotIncome: zInt(),
  mineRadius: zInt(),
  mineTrigger: zInt(),
  mineKills: zInt(),
  mineEliteDamage: zInt(),
  baitPull: zInt(),
  baitActive: zInt(),
  baitCooldown: zInt(),
  turretEliteDamage: zInt(),
  pressureShift: zInt(),
  structureHp: zInt(),
  wallHp: zInt(),
  stoneWallHp: zInt(),
  reinforcedWallHp: zInt(),
  wallSnapRadius: zInt(),
  spanCostPerCell: zInt(),
  wallClearRadius: zInt(),
  repairDelay: zInt(),
  repairInterval: zInt(),
  repairHp: zInt(),
  repairGoldPerHp: zInt(),
  hqHp: zInt(),
  wavesToWin: zInt(),
  startingTurrets: zInt(),
  flowDebounce: zInt(),
  flowMaxDelay: zInt(),
  settleInterval: zInt(),
  settlePercent: zInt(),
  settleTiles: zInt(),
  settleCost: zInt(),
  settleRadius: zInt(),
  settleRadiusPerWave: zInt(),
  refugeesPerWave: zInt(),
  outpostRadius: zInt(),
  buildingClaimRadius: zInt(),
  outpostsBase: zInt(),
  wavesPerOutpost: zInt(),
  crateInterval: zInt(),
  crateMax: zInt(),
  crateMinDistance: zInt(),
  crateMaxDistance: zInt(),
  crateLife: zInt(),
  crateLootTicks: zInt(),
  crateDangerRadius: zInt(),
  crateBaseGold: zInt(),
  crateGoldPerWave: zInt(),
  crateLandingRadius: zInt(),
  crateLandingBonusPercent: zInt(),
  depotCratePercent: zInt(),
  depotCrateMax: zInt(),
  mortarRange: zInt(),
  mortarMinRange: zInt(),
  mortarReload: zInt(),
  mortarFlight: zInt(),
  mortarBlastRadius: zInt(),
  mortarKills: zInt(),
  mortarEliteDamage: zInt(),
  mortarMinTarget: zInt(),
  mortarLevelPercent: zInt(),
});

const CrateStateSchema = z.object({
  random: zRandom(),
  nextId: zInt(),
  crates: z.array(
    z.object({
      id: zInt(),
      tile: zInt(),
      owner: zInt(),
      gold: zInt(),
      expires: zInt(),
      lootEnd: zInt(),
      looter: zInt(),
    }),
  ),
  progressIds: z.array(zInt()),
  progress: z.array(zInt()),
  goldPaid: zInt(),
}) satisfies z.ZodType<CrateState>;

const MortarStateSchema = z.object({
  readyIds: z.array(zInt()),
  readyAt: z.array(zInt()),
  shells: z.array(
    z.object({
      owner: zInt(),
      from: zInt(),
      target: zInt(),
      lands: zInt(),
      power: zInt(),
    }),
  ),
  killed: zInt(),
}) satisfies z.ZodType<MortarState>;

const WavePlanSchema = z.object({
  wave: zInt(),
  budget: zInt(),
  shamblers: zInt(),
  elites: zInt(),
  sectors: zInt(),
  final: z.boolean(),
});

const HordeStateSchema = z.object({
  initialized: z.boolean(),
  options: HordeOptionsSchema,
  random: zRandom(),
  wave: zInt(),
  wavesSurvived: zInt(),
  outpostTiles: z.array(zInt()),
  outpostOwners: z.array(zInt()),
  currentPlan: WavePlanSchema.nullable(),
  nextPlan: WavePlanSchema.nullable(),
  nextWaveTick: zInt(),
  downtimeEndTick: zInt(),
  waveStartTick: zInt(),
  ticks: zInt(),
  density: zU16Array(),
  emitterCells: z.array(zInt()),
  emitterRemaining: z.array(zInt()),
  nextLandings: z.array(zInt()),
  eliteCells: z.array(zInt()),
  eliteHp: z.array(zInt()),
  eliteCooldown: z.array(zInt()),
  damageIds: z.array(zInt()),
  damageValues: z.array(zInt()),
  lastHitIds: z.array(zInt()),
  lastHitTicks: z.array(zInt()),
  beaconIds: z.array(zInt()),
  beaconSince: z.array(zInt()),
  hqIds: z.array(zInt()),
  hqValues: z.array(zInt()),
  hqsFallen: zInt(),
  /** Index into OUTCOMES. */
  outcome: zInt(),
  structureSig: zInt(),
  flowCells: z.array(zInt()).nullable(),
  flowWalls: z.array(zInt()),
  flowBait: z.array(zInt()),
  lastChangeTick: zInt(),
  firstPendingTick: zInt(),
  killed: zInt(),
  structuresDestroyed: zInt(),
  spanIds: z.array(zInt()),
  spanA: z.array(zInt()),
  spanB: z.array(zInt()),
  spanCellCounts: z.array(zInt()),
  spanCells: z.array(zInt()),
  spanDamage: z.array(zInt()),
  spanLastHit: z.array(zInt()),
  spanBroken: z.array(z.boolean()),
  nextSpanId: zInt(),
  linkedWalls: z.array(zInt()),
  /** Null before init. */
  crates: CrateStateSchema.nullable(),
  /** Null before init. */
  mortars: MortarStateSchema.nullable(),
});
type HordeState = z.infer<typeof HordeStateSchema>;

// Frame bytes above the density range (see HordeFrame.cells).
const BYTE_MINE = 248;
const BYTE_BEACON = 249;
const BYTE_BEACON_SOUNDING = 250;
const BYTE_DEPOT = 251;

/** Ints per crate in HordeFrame.crates. */
const CRATE_STRIDE = 5;

const OUTCOMES: readonly HordeOutcome[] = ["playing", "won", "lost"];

/** nextWaveTick before the horde's first tick. */
const NOT_STARTED = -1;
/** nextWaveTick while the wave under way has to be cleared first. */
const WAITING_FOR_CLEAR = -2;

/** The horde running in each game, for executions that act on it. */
const HORDES = new WeakMap<Game, HordeExecution>();

/** The game's horde, or null outside horde mode (or before it starts). */
export function hordeOf(game: Game): HordeExecution | null {
  return HORDES.get(game) ?? null;
}

export const HordeExecutionSnapshot = execSnapshotType({
  name: "Horde",
  version: 16,
  schema: HordeStateSchema,
  migrations: {
    // 1 -> 2: win after N waves and the debounced flow field. A version 1
    // game rebuilt its flow field on the first tick after a restore; no
    // flow cells and no pending change gives the same, as the first scan
    // sees a changed structure set.
    1: (d) => ({
      ...d,
      options: {
        ...d.options,
        wavesToWin: 0,
        flowDebounce: 0,
        flowMaxDelay: 0,
      },
      outcome: 0,
      structureSig: -1,
      flowCells: null,
      lastChangeTick: -1,
      firstPendingTick: -1,
    }),
    // 2 -> 3: walls and the wave director. The wave under way keeps its
    // size; the next one is planned on the first tick after the restore.
    // Elites cost no points, as before.
    2: (d) => ({
      ...d,
      options: {
        ...d.options,
        elitePoints: 0,
        wavesPerDirection: 3,
        minSpawnDistance: 0,
        wallHp: 10_000,
      },
      currentPlan:
        d.wave > 0
          ? {
              wave: d.wave,
              budget: d.waveSize,
              shamblers: d.waveSize,
              elites: d.options.elitesPerWave,
              sectors: 0,
              final: false,
            }
          : null,
      nextPlan: null,
      ticks: 0,
      flowWalls: [],
    }),
    // 3 -> 4: shambler speed. Older games stepped the horde every tick.
    3: (d) => ({
      ...d,
      options: { ...d.options, shamblerSpeed: 1 },
    }),
    // 4 -> 5: population-driven growth. Settling is off (no cost, no
    // zone), so an old game keeps the land it had; every wave before the
    // one under way counts as survived.
    4: (d) => ({
      ...d,
      options: {
        ...d.options,
        settleInterval: 10,
        settlePercent: 50,
        settleTiles: 0,
        settleCost: 0,
        zoneBaseTiles: 0,
        zoneTilesPerWave: 0,
        refugeesPerWave: 0,
      },
      wavesSurvived: Math.max(0, d.wave - 1),
    }),
    // 5 -> 6: wall tiers, turret levels and repair. Health is now kept as
    // damage by unit id; the old health-by-tile map can't be converted
    // without the units, so damaged structures come back at full health.
    // Every wall tier keeps the old wall health, turret levels add nothing,
    // turrets get no high-ground bonus and nothing repairs, as before.
    5: (d) => ({
      ...d,
      options: {
        ...d.options,
        stoneWallHp: d.options.wallHp,
        reinforcedWallHp: d.options.wallHp,
        turretLevelPercent: 0,
        turretHighGroundBonus: 0,
        repairDelay: 0,
        repairInterval: 1,
        repairHp: 0,
        repairGoldPerHp: 0,
      },
      damageIds: [],
      damageValues: [],
      lastHitIds: [],
      lastHitTicks: [],
    }),
    // 6 -> 7: the cash economy and the spawn band. An old game kept
    // OpenFront's 100 gold a tick from the player config, so the HQ
    // trickle takes that over; there were no bounties or clear bonus, and
    // waves could come ashore at any distance.
    6: (d) => ({
      ...d,
      options: {
        ...d.options,
        hqIncome: 100,
        killBounty: 0,
        eliteBounty: 0,
        clearBonusPerWave: 0,
        clearedPercent: 0,
        maxSpawnDistance: 0,
      },
    }),
    // 7 -> 8: calling a wave early, and landings picked when a wave is
    // announced. An old game had no early call; no landings means the
    // announced wave picks them when it starts, as before.
    7: (d) => ({
      ...d,
      options: { ...d.options, callEarlyGoldPerTick: 0 },
      nextLandings: [],
    }),
    // 8 -> 9: mines, noise beacons and scavenger depots. None could be
    // built before, so their options never come into play.
    8: (d) => ({
      ...d,
      options: {
        ...d.options,
        depotIncome: 0,
        mineRadius: 0,
        mineTrigger: 0,
        mineKills: 0,
        mineEliteDamage: 0,
        baitPull: 0,
        baitActive: 0,
        baitCooldown: 0,
      },
      beaconIds: [],
      beaconSince: [],
      flowBait: [],
    }),
    // 9 -> 10: a free turret at the start. An old game has started already
    // (or builds none, as before).
    9: (d) => ({
      ...d,
      options: { ...d.options, startingTurrets: 0 },
    }),
    // 10 -> 11: wall spans. A restored game keeps its walls as they were:
    // no snapping, so no spans.
    10: (d) => ({
      ...d,
      options: {
        ...d.options,
        wallSnapRadius: 0,
        spanCostPerCell: 0,
        wallClearRadius: 0,
      },
      spanIds: [],
      spanA: [],
      spanB: [],
      spanCellCounts: [],
      spanCells: [],
      spanDamage: [],
      spanLastHit: [],
      spanBroken: [],
      nextSpanId: 1,
      linkedWalls: [],
    }),
    // 11 -> 12: Outposts and building claims. Settlers fill a disc round the
    // HQ instead of a tile count; buildings in an old game start claiming
    // land on the next pass.
    11: (d) => {
      const options = { ...d.options };
      delete options.zoneBaseTiles;
      delete options.zoneTilesPerWave;
      return {
        ...d,
        options: {
          ...options,
          settleRadius: 14,
          settleRadiusPerWave: 2,
          outpostRadius: 12,
          buildingClaimRadius: 3,
          outpostsBase: 1,
          wavesPerOutpost: 2,
        },
        outpostTiles: [],
        outpostOwners: [],
      };
    },
    // 12 -> 13: supply drops. An old game keeps its economy (its options
    // carry its HQ trickle and depot income) and gets no crates.
    12: (d) => ({
      ...d,
      options: {
        ...d.options,
        crateInterval: 0,
        crateMax: 0,
        crateMinDistance: 0,
        crateMaxDistance: 0,
        crateLife: 0,
        crateLootTicks: 0,
        crateDangerRadius: 0,
        crateBaseGold: 0,
        crateGoldPerWave: 0,
        crateLandingRadius: 0,
        crateLandingBonusPercent: 0,
        depotCratePercent: 0,
        depotCrateMax: 0,
      },
      crates: null,
    }),
    // 13 -> 14: Missile Silos become mortars. In an old game they did
    // nothing to the horde, so they still don't.
    13: (d) => ({
      ...d,
      options: {
        ...d.options,
        mortarRange: 0,
        mortarMinRange: 0,
        mortarReload: 0,
        mortarFlight: 0,
        mortarBlastRadius: 0,
        mortarKills: 0,
        mortarEliteDamage: 0,
        mortarMinTarget: 0,
        mortarLevelPercent: 0,
      },
      mortars: null,
    }),
    // 14 -> 15: turret volleys and inland spawns. Older games fired every
    // tick and only spawned on the shore and the map edge.
    14: (d) => ({
      ...d,
      options: { ...d.options, turretFireInterval: 1, inlandSpawns: 0 },
    }),
    // 15 -> 16: downtime between waves. An old game's next wave keeps the
    // tick it was due on, with no downtime marked before it; from then on
    // it plays by the new rules, and a stall lasts its old wave interval.
    15: (d) => {
      const { waveInterval, ...options } = d.options;
      return {
        ...d,
        options: {
          ...options,
          downtimeTicks: DOWNTIME_TICKS,
          waveCountdown: 300,
          maxWaveTicks: waveInterval,
        },
        downtimeEndTick: -1,
        waveStartTick: d.nextWaveTick - waveInterval,
      };
    },
  },
  cls: () => HordeExecution,
});
