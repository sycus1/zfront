import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
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
import { FlowField } from "./FlowField";
import { buildCostField, HordeField } from "./HordeField";

/**
 * Zombie waves (zfront spike). The mass horde is a density field on the
 * coarse map that flows toward player structures; elites are discrete
 * agents on the same flow field. Structures are obstacles: blocked zombies
 * press on them until they fall. Defense Posts stand in for turrets.
 *
 * Deterministic: integer state, a seeded PRNG for spawn points, and a fixed
 * scan order everywhere. Timings are recorded for the perf harness only and
 * never feed back into the simulation.
 */

export interface HordeOptions {
  /** Ticks from the end of the spawn phase to the first wave. */
  firstWaveDelay: number;
  waveInterval: number;
  firstWaveSize: number;
  /** Each wave is this many percent bigger than the last. */
  waveGrowthPercent: number;
  emittersPerWave: number;
  /** Zombies each emitter releases per tick until its share is out. */
  emitRate: number;
  elitesPerWave: number;
  maxElites: number;
  eliteHp: number;
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
  /** HQ health. When it falls, the player loses. */
  hqHp: number;
}

// Spike defaults, sized to show a big horde in a solo game within minutes:
// waves of 20k, 30k, 45k, 67k, 100k... every 30 seconds.
export const DEFAULT_HORDE_OPTIONS: HordeOptions = {
  firstWaveDelay: 100,
  waveInterval: 300,
  firstWaveSize: 20_000,
  waveGrowthPercent: 50,
  emittersPerWave: 8,
  emitRate: 200,
  elitesPerWave: 50,
  maxElites: 500,
  eliteHp: 300,
  eliteSpeed: 1,
  elitePressure: 200,
  blockedMagnitude: 20,
  cellCap: 2_000,
  turretRange: 8,
  turretKillsPerTick: 30,
  turretEliteDamage: 20,
  pressureShift: 6,
  structureHp: 3_000,
  hqHp: 50_000,
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

  private wave = 0;
  private waveSize = 0;
  private nextWaveTick = -1;
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
    if (this.mg === null) return;
    if (this.nextWaveTick < 0) {
      this.nextWaveTick = ticks + this.opts.firstWaveDelay;
    }
    this.scanStructures();
    if (ticks >= this.nextWaveTick) {
      this.startWave();
      this.nextWaveTick = ticks + this.opts.waveInterval;
    }
    this.emit();
    this.field.step(this.hordeFlow.dist);
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
      ...this.hordeProfile,
    };
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
      if (v !== 0) cells[i] = v >= 254 * 8 ? 254 : (v + 7) >> 3;
    }
    for (let k = 0; k < this.elites.count; k++) {
      cells[this.elites.cell[k]] = 255;
    }
    return {
      width: this.width,
      height: this.height,
      cells,
      alive: this.field.total(),
      elites: this.elites.count,
      wave: this.wave,
      hqHp: this.firstHqHp(),
      hqMaxHp: this.opts.hqHp,
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
    mix(this.killed);
    mix(this.structuresDestroyed);
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
   * Runs every tick but only rebuilds the obstacle map and flow field when
   * the structure set changed. Scanning every tick (rather than on an
   * interval) keeps snapshot restore exact: the first tick after a restore
   * rebuilds from the same units the original game would.
   */
  private scanStructures(): void {
    const units = this.mg!.units(TARGET_TYPES);
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
    sig = Math.imul(sig ^ (units.length + hqs.length), 16777619) >>> 0;
    if (sig === this.hordeStructureSig) return;
    this.hordeStructureSig = sig;

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
    const cost = this.hordeFlow.cost;
    cost.set(this.terrainCost);
    for (const c of cells) {
      if (cost[c] === 0) cost[c] = 1;
    }
    const start = performance.now();
    this.hordeFlow.compute(cells);
    const ms = performance.now() - start;
    const prof = this.hordeProfile;
    prof.recomputes++;
    prof.lastRecomputeMs = ms;
    prof.totalRecomputeMs += ms;
    if (ms > prof.maxRecomputeMs) prof.maxRecomputeMs = ms;
  }

  private startWave(): void {
    if (this.spawnCells.length === 0) return;
    this.waveSize =
      this.wave === 0
        ? this.opts.firstWaveSize
        : Math.floor(
            (this.waveSize * (100 + this.opts.waveGrowthPercent)) / 100,
          );
    this.wave++;
    const n = this.opts.emittersPerWave;
    const share = Math.floor(this.waveSize / n);
    for (let j = 0; j < n; j++) {
      const cell =
        this.spawnCells[this.random.nextInt(0, this.spawnCells.length)];
      this.emitterCells.push(cell);
      this.emitterRemaining.push(
        j === 0 ? share + (this.waveSize - share * n) : share,
      );
    }
    for (let j = 0; j < this.opts.elitesPerWave; j++) {
      const cell =
        this.spawnCells[this.random.nextInt(0, this.spawnCells.length)];
      this.elites.spawn(cell, this.opts.eliteHp);
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
      const hp =
        (this.structureHp.get(key) ?? this.opts.structureHp) -
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
      this.mg!.setWinner(null, this.mg!.stats().stats());
    }
  }

  snapshot(): ExecRecord {
    const e = this.elites;
    return HordeExecutionSnapshot.write({
      initialized: this.mg !== null,
      options: this.opts,
      random: this.random.getState(),
      wave: this.wave,
      waveSize: this.waveSize,
      nextWaveTick: this.nextWaveTick,
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
      killed: this.killed,
      structuresDestroyed: this.structuresDestroyed,
    });
  }

  restoreSnapshot(s: HordeState, r: SnapshotReader): void {
    const opts = { ...DEFAULT_HORDE_OPTIONS, ...s.options };
    this.opts = opts;
    this.mg = null;
    this.wave = s.wave;
    this.waveSize = s.waveSize;
    this.nextWaveTick = s.nextWaveTick;
    this.killed = s.killed;
    this.structuresDestroyed = s.structuresDestroyed;
    this.hqsFallen = s.hqsFallen;
    this.hordeProfile = newProfile();
    this.hordeStructureSig = -1;
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
    // hordeStructureSig is -1, so the next tick rescans and rebuilds the flow field.
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
  maxElites: zInt(),
  eliteHp: zInt(),
  eliteSpeed: zInt(),
  elitePressure: zInt(),
  blockedMagnitude: zInt(),
  cellCap: zInt(),
  turretRange: zInt(),
  turretKillsPerTick: zInt(),
  turretEliteDamage: zInt(),
  pressureShift: zInt(),
  structureHp: zInt(),
  hqHp: zInt(),
});

const HordeStateSchema = z.object({
  initialized: z.boolean(),
  options: HordeOptionsSchema,
  random: zRandom(),
  wave: zInt(),
  waveSize: zInt(),
  nextWaveTick: zInt(),
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
  killed: zInt(),
  structuresDestroyed: zInt(),
});
type HordeState = z.infer<typeof HordeStateSchema>;

export const HordeExecutionSnapshot = execSnapshotType({
  name: "Horde",
  version: 1,
  schema: HordeStateSchema,
  cls: () => HordeExecution,
});
