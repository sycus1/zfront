import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { UNREACHABLE } from "./FlowField";

/**
 * Plans zombie waves (zfront). Each wave has a points budget that grows by a
 * fixed percentage, split between shamblers (one point each) and elites. A
 * wave comes from one or more compass directions around the player's HQ:
 * one at first, one more every few waves, and every direction for the final
 * wave. The next wave is planned as soon as the previous one starts, so the
 * HUD can announce its size and directions during the calm.
 *
 * Deterministic: integer maths and the horde's seeded PRNG.
 */

/** Compass sectors, clockwise from north. Bit k of a sector mask is sector k. */
export const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export const NUM_SECTORS = SECTORS.length;

export interface WavePlan {
  /** 1-based wave number. */
  wave: number;
  /** Points for the whole wave. */
  budget: number;
  shamblers: number;
  elites: number;
  /** Bit mask of the sectors the wave comes from. */
  sectors: number;
  /** The last wave before the win: it comes from every side. */
  final: boolean;
}

export interface DirectorOptions {
  /** Points for the first wave. */
  firstWaveSize: number;
  /** Each wave's budget is this many percent bigger than the last. */
  waveGrowthPercent: number;
  /** Elites in the first wave; later waves scale with the budget. */
  elitesPerWave: number;
  /** Budget points one elite costs. */
  elitePoints: number;
  /** Waves are spread over one more direction every this many waves. */
  wavesPerDirection: number;
  /** Spawn cells closer than this to the HQ (in coarse cells) are skipped. */
  minSpawnDistance: number;
  /**
   * Spawn cells further than this from the HQ are only used when there are
   * none in between, so a wave arrives before the next one; 0 means no limit.
   */
  maxSpawnDistance: number;
  emittersPerWave: number;
  /** Waves to survive to win; 0 means endless (no final wave). */
  wavesToWin: number;
}

/**
 * The compass sector of an offset, in grid coordinates (y grows south). The
 * octant edges sit at about 22.5 degrees (tan = 5 / 12), worked out with
 * integers only.
 */
export function sectorOf(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (12 * ay <= 5 * ax) return dx >= 0 ? 2 : 6; // E or W
  if (12 * ax <= 5 * ay) return dy < 0 ? 0 : 4; // N or S
  if (dy < 0) return dx > 0 ? 1 : 7; // NE or NW
  return dx > 0 ? 3 : 5; // SE or SW
}

export class WaveDirector {
  /** Reachable spawn cells far enough from the centre, by sector. */
  private bySector: number[][] = [];

  constructor(
    private readonly opts: DirectorOptions,
    private readonly width: number,
  ) {}

  /**
   * Sorts the spawn cells into sectors around `centre`, keeping only cells
   * the horde can walk from (by the current flow field). Cells between
   * `minSpawnDistance` and `maxSpawnDistance` are used when there are any;
   * failing that, any beyond `minSpawnDistance`; failing that, all of them.
   * With `perSector`, a sector with no cells in the band uses its own cells
   * beyond it, so a sector whose band is all taken (by held districts)
   * spawns further out rather than closing.
   */
  survey(
    spawnCells: Int32Array,
    centre: number,
    dist: Uint32Array,
    perSector = false,
  ): void {
    const w = this.width;
    const cx = centre % w;
    const cy = (centre - cx) / w;
    const near: number[][] = [];
    const far: number[][] = [];
    const band: number[][] = [];
    for (let s = 0; s < NUM_SECTORS; s++) {
      near.push([]);
      far.push([]);
      band.push([]);
    }
    const min2 = this.opts.minSpawnDistance * this.opts.minSpawnDistance;
    const max = this.opts.maxSpawnDistance;
    const max2 = max > 0 ? max * max : Number.MAX_SAFE_INTEGER;
    let anyFar = false;
    let anyBand = false;
    for (let k = 0; k < spawnCells.length; k++) {
      const cell = spawnCells[k];
      if (dist[cell] === UNREACHABLE) continue;
      const x = cell % w;
      const dx = x - cx;
      const dy = (cell - x) / w - cy;
      const s = sectorOf(dx, dy);
      const d2 = dx * dx + dy * dy;
      if (d2 < min2) {
        near[s].push(cell);
        continue;
      }
      far[s].push(cell);
      anyFar = true;
      if (d2 <= max2) {
        band[s].push(cell);
        anyBand = true;
      }
    }
    if (perSector && anyFar) {
      // Never closer than the band: a sector with nothing beyond it closes.
      this.bySector = band.map((cells, s) =>
        cells.length > 0 ? cells : far[s],
      );
      return;
    }
    this.bySector = anyBand
      ? band
      : anyFar
        ? far
        : near.map((cells, s) => [...cells, ...far[s]]);
  }

  /** Bit mask of the sectors that have spawn cells. */
  availableSectors(): number {
    let mask = 0;
    this.bySector.forEach((cells, s) => {
      if (cells.length > 0) mask |= 1 << s;
    });
    return mask;
  }

  /** Plans wave `previous.wave + 1` (or wave 1 when `previous` is null). */
  plan(previous: WavePlan | null, random: PseudoRandom): WavePlan {
    const o = this.opts;
    const wave = previous === null ? 1 : previous.wave + 1;
    const budget =
      previous === null
        ? o.firstWaveSize
        : Math.floor((previous.budget * (100 + o.waveGrowthPercent)) / 100);
    const scaled =
      o.firstWaveSize > 0
        ? Math.floor((o.elitesPerWave * budget) / o.firstWaveSize)
        : o.elitesPerWave;
    const elites =
      o.elitePoints > 0
        ? Math.min(scaled, Math.floor(budget / o.elitePoints))
        : scaled;
    const shamblers = budget - elites * o.elitePoints;

    const available: number[] = [];
    const mask = this.availableSectors();
    for (let s = 0; s < NUM_SECTORS; s++) {
      if (mask & (1 << s)) available.push(s);
    }
    const final = o.wavesToWin > 0 && wave === o.wavesToWin;
    const wanted = final
      ? available.length
      : Math.min(
          available.length,
          1 + Math.floor((wave - 1) / Math.max(1, o.wavesPerDirection)),
        );
    // A partial Fisher-Yates shuffle picks `wanted` distinct sectors.
    let sectors = 0;
    for (let k = 0; k < wanted; k++) {
      const j = random.nextInt(k, available.length);
      const pick = available[j];
      available[j] = available[k];
      available[k] = pick;
      sectors |= 1 << pick;
    }
    return { wave, budget, shamblers, elites, sectors, final };
  }

  /**
   * Spawn cells for a wave's emitters, dealt round-robin across its sectors.
   * Sectors that have run out of cells since the plan fall back to any
   * spawn cell; returns an empty list when there are none at all.
   */
  emitterCells(plan: WavePlan, count: number, random: PseudoRandom): number[] {
    const pools: number[][] = [];
    for (let s = 0; s < NUM_SECTORS; s++) {
      if (plan.sectors & (1 << s) && this.bySector[s]?.length > 0) {
        pools.push(this.bySector[s]);
      }
    }
    if (pools.length === 0) {
      const all = this.bySector.flat();
      if (all.length === 0) return [];
      pools.push(all);
    }
    const n = Math.max(count, pools.length);
    const cells: number[] = [];
    for (let k = 0; k < n; k++) {
      const pool = pools[k % pools.length];
      cells.push(pool[random.nextInt(0, pool.length)]);
    }
    return cells;
  }
}
