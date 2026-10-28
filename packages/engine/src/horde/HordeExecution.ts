import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  HordeFrame,
  HordeOutcome,
} from "@openfront/engine-api/game/GameUpdates";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zRandom,
  zU16Array,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";
import { Elites } from "./Elites";
import { FlowField, WALL_COST } from "./FlowField";
import { buildCostField, HordeField } from "./HordeField";
import { WaveDirector, WavePlan } from "./WaveDirector";

/**
 * Zombie waves (zfront spike). The mass horde is a density field on the
 * coarse map that flows toward player structures; elites are discrete
 * agents on the same flow field. Structures are obstacles: blocked zombies
 * press on them until they fall. Walls are obstacles too, but not targets:
 * the horde goes round them where it can and breaks through where it must.
 * Defense Posts stand in for turrets. The WaveDirector plans each wave's
 * size and directions.
 *
 * The player wins by keeping their HQ standing until the wave after
 * `wavesToWin` would arrive, and loses when every human HQ has fallen.
 * Either way the horde then stops.
 *
 * Deterministic: integer state, a seeded PRNG for spawn points, and a fixed
 * scan order everywhere. Timings are recorded for the perf harness only and
 * never feed back into the simulation.
 */

export interface HordeOptions {
  /** Ticks from the end of the spawn phase to the first wave. */
  firstWaveDelay: number;
  waveInterval: number;
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
  turretEliteDamage: number;
  /** Structure damage per tick is pressure >> pressureShift. */
  pressureShift: number;
  structureHp: number;
  wallHp: number;
  /** HQ health. When it falls, the player loses. */
  hqHp: number;
  /** Waves to survive to win; 0 means endless. */
  wavesToWin: number;
  /**
   * Ticks the structure set must stay unchanged before the flow field is
   * recomputed, so placing a row of walls costs one recompute, not one each.
   */
  flowDebounce: number;
  /** Longest a recompute may wait while structures keep changing. */
  flowMaxDelay: number;
}

// MVP defaults, tuned with `npm run balance:horde` (see "MVP: balance" in
// docs/zfront/spike-plan.md): a minute to build before the first wave of
// 2,500, a wave a minute growing by 35% to about 37k on wave 10, and
// shamblers that walk a coarse cell every 3 ticks. An undefended HQ falls
// on wave 4 or 5; a ring of Defense Posts wins with the HQ damaged.
export const DEFAULT_HORDE_OPTIONS: HordeOptions = {
  firstWaveDelay: 600,
  waveInterval: 600,
  firstWaveSize: 2_500,
  waveGrowthPercent: 35,
  emittersPerWave: 8,
  emitRate: 200,
  elitesPerWave: 2,
  elitePoints: 20,
  wavesPerDirection: 3,
  minSpawnDistance: 40,
  maxElites: 500,
  eliteHp: 300,
  shamblerSpeed: 3,
  eliteSpeed: 2,
  elitePressure: 200,
  blockedMagnitude: 20,
  cellCap: 2_000,
  turretRange: 8,
  turretKillsPerTick: 12,
  turretEliteDamage: 20,
  pressureShift: 5,
  structureHp: 3_000,
  wallHp: 10_000,
  hqHp: 50_000,
  wavesToWin: 10,
  flowDebounce: 10,
  flowMaxDelay: 50,
};

const TARGET_TYPES: readonly UnitType[] = [
  UnitType.City,
  UnitType.DefensePost,
  UnitType.Port,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Factory,
];

export interface HordeStats {
  wave: number;
  alive: number;
  elites: number;
  killed: number;
  structuresDestroyed: number;
  /** The first human player's HQ health, or 0 when none is alive. */
  hqHp: number;
  hqsFallen: number;
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
  private turretOffsets!: Int32Array;
  /** Terrain movement cost; the live cost adds structure cells on top. */
  private terrainCost!: Uint8Array;
  private director!: WaveDirector;

  private wave = 0;
  /** The wave under way (or last started), and the one announced next. */
  private currentPlan: WavePlan | null = null;
  private nextPlan: WavePlan | null = null;
  private nextWaveTick = -1;
  private ticks = 0;
  private emitterCells: number[] = [];
  private emitterRemaining: number[] = [];

  private hordeStructureSig = -1;
  private hordeStructureAt = new Map<number, Unit>();
  private hordeTurrets: Unit[] = [];
  private hordeHqAt = new Map<number, Player>();
  private structureHp = new Map<TileRef, number>();
  /** HQ health by player smallID. */
  private hqHp = new Map<number, number>();
  private hqsFallen = 0;
  private outcome: HordeOutcome = "playing";

  /** Target cells (structures and HQs) from the latest scan. */
  private hordeTargetCells: number[] = [];
  /** Wall cells from the latest scan: obstacles, but not targets. */
  private hordeWallCells: number[] = [];
  /** Target cells the flow field was last computed from; null before the first. */
  private flowCells: number[] | null = null;
  private flowWalls: number[] = [];
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
    this.spawnCells = coastalCells(
      mg,
      this.terrainCost,
      this.width,
      this.height,
    );
    this.turretOffsets = discOffsets(opts.turretRange, this.width);
    this.director = new WaveDirector(opts, this.width);
    this.hordeStructureAt = new Map();
    this.hordeTurrets = [];
    this.hordeHqAt = new Map();
    this.structureHp = new Map();
    this.hqHp = new Map();
    this.emitterCells = [];
    this.emitterRemaining = [];
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.outcome !== "playing") return;
    this.ticks = ticks;
    if (this.nextWaveTick < 0) {
      this.nextWaveTick = ticks + this.opts.firstWaveDelay;
    }
    this.scanStructures(ticks);
    this.planNextWave();
    if (ticks >= this.nextWaveTick) {
      if (this.allWavesStarted()) {
        this.win();
        return;
      }
      this.startWave();
      this.nextWaveTick = ticks + this.opts.waveInterval;
      this.planNextWave();
    }
    this.emit();
    if (ticks % this.opts.shamblerSpeed === 0) {
      this.field.step(this.hordeFlow.dist);
    }
    this.elites.step(this.field, this.hordeFlow.dist);
    this.fireTurrets();
    this.applyPressure();
  }

  stats(): HordeStats {
    return {
      wave: this.wave,
      alive: this.field?.total() ?? 0,
      elites: this.elites?.count ?? 0,
      killed: this.killed,
      structuresDestroyed: this.structuresDestroyed,
      hqHp: this.firstHqHp(),
      hqsFallen: this.hqsFallen,
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
      if (v !== 0) cells[i] = v >= 253 * 8 ? 253 : (v + 7) >> 3;
    }
    for (const c of this.hordeWallCells) cells[c] = 254;
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
        this.outcome === "playing" && this.nextWaveTick >= 0
          ? Math.max(0, this.nextWaveTick - this.ticks)
          : -1,
      nextWave: next?.wave ?? 0,
      nextWaveShamblers: next?.shamblers ?? 0,
      nextWaveElites: next?.elites ?? 0,
      nextWaveSectors: next?.sectors ?? 0,
      nextWaveFinal: next?.final ?? false,
      encodeMs: 0,
      sentAt: 0,
    };
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
    for (const plan of [this.currentPlan, this.nextPlan]) {
      if (plan === null) continue;
      mix(plan.wave);
      mix(plan.budget);
      mix(plan.sectors);
    }
    mix(this.killed);
    mix(this.structuresDestroyed);
    mix(OUTCOMES.indexOf(this.outcome));
    for (const [id, hp] of this.hqHp) {
      mix(id);
      mix(hp);
    }
    return h >>> 0;
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
    sig = Math.imul(sig ^ walls.length, 16777619) >>> 0;
    const changed = sig !== this.hordeStructureSig;
    if (changed || this.hordeObstaclesStale) {
      this.rebuildObstacles(units, walls, hqs, hqOwners);
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
      this.computeFlow(this.hordeTargetCells, this.hordeWallCells);
      this.firstPendingTick = -1;
    }
  }

  private rebuildObstacles(
    units: readonly Unit[],
    walls: readonly Unit[],
    hqs: readonly TileRef[],
    hqOwners: readonly Player[],
  ): void {
    const obstacle = this.field.obstacle;
    obstacle.fill(0);
    this.hordeStructureAt.clear();
    this.hordeTurrets = [];
    const cells: number[] = [];
    for (const u of units) {
      const cell = this.cellOf(u.tile());
      if (obstacle[cell] === 0) {
        obstacle[cell] = 1;
        cells.push(cell);
        this.hordeStructureAt.set(cell, u);
      }
      if (u.type() === UnitType.DefensePost) this.hordeTurrets.push(u);
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
    // Walls last: a cell already holding a target stays a target.
    const wallCells: number[] = [];
    for (const u of walls) {
      const cell = this.cellOf(u.tile());
      if (obstacle[cell] !== 0) continue;
      obstacle[cell] = 1;
      wallCells.push(cell);
      this.hordeStructureAt.set(cell, u);
    }
    this.hordeWallCells = wallCells;
  }

  /**
   * Recomputes the flow field toward `cells`, which become enterable. Wall
   * cells (on walkable terrain) get WALL_COST, so the flow goes round them
   * unless there is no other way in.
   */
  private computeFlow(
    cells: readonly number[],
    walls: readonly number[],
  ): void {
    const cost = this.hordeFlow.cost;
    cost.set(this.terrainCost);
    for (const c of walls) {
      if (cost[c] !== 0) cost[c] = WALL_COST;
    }
    for (const c of cells) {
      if (cost[c] === 0) cost[c] = 1;
    }
    const start = performance.now();
    this.hordeFlow.compute(cells);
    this.flowCells = [...cells];
    this.flowWalls = [...walls];
    const ms = performance.now() - start;
    const prof = this.hordeProfile;
    prof.recomputes++;
    prof.lastRecomputeMs = ms;
    prof.totalRecomputeMs += ms;
    if (ms > prof.maxRecomputeMs) prof.maxRecomputeMs = ms;
  }

  private allWavesStarted(): boolean {
    return this.opts.wavesToWin > 0 && this.wave >= this.opts.wavesToWin;
  }

  /** Plans (and so announces) the next wave once the last one has started. */
  private planNextWave(): void {
    if (this.nextPlan !== null || this.allWavesStarted()) return;
    this.surveySpawns();
    this.nextPlan = this.director.plan(this.currentPlan, this.random);
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
    this.currentPlan = plan;
    this.wave = plan.wave;
    this.surveySpawns();
    const cells = this.director.emitterCells(
      plan,
      this.opts.emittersPerWave,
      this.random,
    );
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

  private fireTurrets(): void {
    const w = this.width;
    const n = w * this.height;
    const r2 = this.opts.turretRange * this.opts.turretRange;
    const offsets = this.turretOffsets;
    for (const t of this.hordeTurrets) {
      if (!t.isActive()) continue;
      const c = this.cellOf(t.tile());
      const cx = c % w;
      const cy = (c - cx) / w;
      let budget = this.opts.turretKillsPerTick;
      for (let k = 0; k < offsets.length && budget > 0; k += 2) {
        const x = cx + offsets[k];
        const cell = c + offsets[k + 1];
        if (x < 0 || x >= w || cell < 0 || cell >= n) continue;
        const removed = this.field.remove(cell, budget);
        budget -= removed;
        this.killed += removed;
      }
      // One elite per turret per tick: the first in range.
      for (let e = 0; e < this.elites.count; e++) {
        const ec = this.elites.cell[e];
        const ex = ec % w;
        const ey = (ec - ex) / w;
        const dx = ex - cx;
        const dy = ey - cy;
        if (dx * dx + dy * dy <= r2 && this.elites.hp[e] > 0) {
          this.elites.hp[e] -= this.opts.turretEliteDamage;
          break;
        }
      }
    }
    this.killed += this.elites.removeDead();
  }

  private applyPressure(): void {
    this.field.drainPressure((cell, pressure) => {
      const u = this.hordeStructureAt.get(cell);
      if (u === undefined || !u.isActive()) {
        const owner = this.hordeHqAt.get(cell);
        if (owner !== undefined) this.damageHq(owner, pressure);
        return;
      }
      const key = u.tile();
      const maxHp =
        u.type() === UnitType.Wall ? this.opts.wallHp : this.opts.structureHp;
      const hp =
        (this.structureHp.get(key) ?? maxHp) -
        (pressure >> this.opts.pressureShift);
      if (hp > 0) {
        this.structureHp.set(key, hp);
        return;
      }
      this.structureHp.delete(key);
      u.delete(false);
      this.structuresDestroyed++;
    });
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
    if (!humansLeft) {
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
      currentPlan: this.currentPlan,
      nextPlan: this.nextPlan,
      nextWaveTick: this.nextWaveTick,
      ticks: this.ticks,
      density:
        this.mg !== null ? this.field.density.slice() : new Uint16Array(),
      emitterCells: [...this.emitterCells],
      emitterRemaining: [...this.emitterRemaining],
      eliteCells: e ? Array.from(e.cell.subarray(0, e.count)) : [],
      eliteHp: e ? Array.from(e.hp.subarray(0, e.count)) : [],
      eliteCooldown: e ? Array.from(e.cooldown.subarray(0, e.count)) : [],
      hpTiles: [...this.structureHp.keys()],
      hpValues: [...this.structureHp.values()],
      hqIds: [...this.hqHp.keys()],
      hqValues: [...this.hqHp.values()],
      hqsFallen: this.hqsFallen,
      outcome: OUTCOMES.indexOf(this.outcome),
      structureSig: this.hordeStructureSig,
      flowCells: this.flowCells === null ? null : [...this.flowCells],
      flowWalls: [...this.flowWalls],
      lastChangeTick: this.lastChangeTick,
      firstPendingTick: this.firstPendingTick,
      killed: this.killed,
      structuresDestroyed: this.structuresDestroyed,
    });
  }

  restoreSnapshot(s: HordeState, r: SnapshotReader): void {
    const opts = { ...DEFAULT_HORDE_OPTIONS, ...s.options };
    this.opts = opts;
    this.mg = null;
    this.wave = s.wave;
    this.currentPlan = s.currentPlan;
    this.nextPlan = s.nextPlan;
    this.nextWaveTick = s.nextWaveTick;
    this.ticks = s.ticks;
    this.killed = s.killed;
    this.structuresDestroyed = s.structuresDestroyed;
    this.hqsFallen = s.hqsFallen;
    this.outcome = OUTCOMES[s.outcome];
    this.hordeProfile = newProfile();
    this.hordeStructureSig = s.structureSig;
    this.hordeTargetCells = [];
    this.hordeWallCells = [];
    this.flowCells = null;
    this.flowWalls = [];
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
    for (let k = 0; k < s.eliteCells.length; k++) {
      this.elites.spawn(s.eliteCells[k], s.eliteHp[k]);
      this.elites.cooldown[k] = s.eliteCooldown[k];
    }
    this.structureHp = new Map(
      s.hpTiles.map((t, i) => [t as TileRef, s.hpValues[i]]),
    );
    this.hqHp = new Map(s.hqIds.map((id, i) => [id, s.hqValues[i]]));
    if (s.flowCells !== null) this.computeFlow(s.flowCells, s.flowWalls);
  }
}

function newProfile() {
  return {
    recomputes: 0,
    lastRecomputeMs: 0,
    maxRecomputeMs: 0,
    totalRecomputeMs: 0,
  };
}

/** Land cells on the map edge or next to water: where waves come ashore. */
function coastalCells(
  mg: Game,
  cost: Uint8Array,
  w: number,
  h: number,
): Int32Array {
  const mini = mg.miniMap();
  const cells: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cost[i] === 0) continue;
      let coastal = x === 0 || y === 0 || x === w - 1 || y === h - 1;
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
 * in row-major order, so turrets always pick targets the same way.
 */
function discOffsets(r: number, w: number): Int32Array {
  const pts: [number, number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r) pts.push([d2, dy, dx]);
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const out = new Int32Array(pts.length * 2);
  pts.forEach(([, dy, dx], k) => {
    out[2 * k] = dx;
    out[2 * k + 1] = dy * w + dx;
  });
  return out;
}

const HordeOptionsSchema = z.object({
  firstWaveDelay: zInt(),
  waveInterval: zInt(),
  firstWaveSize: zInt(),
  waveGrowthPercent: zInt(),
  emittersPerWave: zInt(),
  emitRate: zInt(),
  elitesPerWave: zInt(),
  elitePoints: zInt(),
  wavesPerDirection: zInt(),
  minSpawnDistance: zInt(),
  maxElites: zInt(),
  eliteHp: zInt(),
  shamblerSpeed: zInt(),
  eliteSpeed: zInt(),
  elitePressure: zInt(),
  blockedMagnitude: zInt(),
  cellCap: zInt(),
  turretRange: zInt(),
  turretKillsPerTick: zInt(),
  turretEliteDamage: zInt(),
  pressureShift: zInt(),
  structureHp: zInt(),
  wallHp: zInt(),
  hqHp: zInt(),
  wavesToWin: zInt(),
  flowDebounce: zInt(),
  flowMaxDelay: zInt(),
});

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
  currentPlan: WavePlanSchema.nullable(),
  nextPlan: WavePlanSchema.nullable(),
  nextWaveTick: zInt(),
  ticks: zInt(),
  density: zU16Array(),
  emitterCells: z.array(zInt()),
  emitterRemaining: z.array(zInt()),
  eliteCells: z.array(zInt()),
  eliteHp: z.array(zInt()),
  eliteCooldown: z.array(zInt()),
  hpTiles: z.array(zInt()),
  hpValues: z.array(zInt()),
  hqIds: z.array(zInt()),
  hqValues: z.array(zInt()),
  hqsFallen: zInt(),
  /** Index into OUTCOMES. */
  outcome: zInt(),
  structureSig: zInt(),
  flowCells: z.array(zInt()).nullable(),
  flowWalls: z.array(zInt()),
  lastChangeTick: zInt(),
  firstPendingTick: zInt(),
  killed: zInt(),
  structuresDestroyed: zInt(),
});
type HordeState = z.infer<typeof HordeStateSchema>;

const OUTCOMES: readonly HordeOutcome[] = ["playing", "won", "lost"];

export const HordeExecutionSnapshot = execSnapshotType({
  name: "Horde",
  version: 4,
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
  },
  cls: () => HordeExecution,
});
