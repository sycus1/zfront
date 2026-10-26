import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { UNREACHABLE } from "@openfront/engine/horde/FlowField";
import {
  DirectorOptions,
  NUM_SECTORS,
  sectorOf,
  WaveDirector,
  WavePlan,
} from "@openfront/engine/horde/WaveDirector";

const OPTS: DirectorOptions = {
  firstWaveSize: 1_000,
  waveGrowthPercent: 50,
  elitesPerWave: 10,
  elitePoints: 20,
  wavesPerDirection: 3,
  minSpawnDistance: 5,
  emittersPerWave: 4,
  wavesToWin: 8,
};

// A 21x21 grid with the centre at (10, 10) and a spawn cell on every edge
// cell, so every sector has cells.
const W = 21;
const CENTRE = 10 * W + 10;

function edgeCells(): Int32Array {
  const cells: number[] = [];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === W - 1) {
        cells.push(y * W + x);
      }
    }
  }
  return Int32Array.from(cells);
}

function reachable(): Uint32Array {
  return new Uint32Array(W * W);
}

function sectorsOf(mask: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < NUM_SECTORS; s++) if (mask & (1 << s)) out.push(s);
  return out;
}

function planWaves(
  director: WaveDirector,
  random: PseudoRandom,
  n: number,
): WavePlan[] {
  const plans: WavePlan[] = [];
  let prev: WavePlan | null = null;
  for (let k = 0; k < n; k++) {
    prev = director.plan(prev, random);
    plans.push(prev);
  }
  return plans;
}

describe("sectorOf", () => {
  test("maps the eight compass directions, with y growing south", () => {
    expect(sectorOf(0, -10)).toBe(0); // N
    expect(sectorOf(10, -10)).toBe(1); // NE
    expect(sectorOf(10, 0)).toBe(2); // E
    expect(sectorOf(10, 10)).toBe(3); // SE
    expect(sectorOf(0, 10)).toBe(4); // S
    expect(sectorOf(-10, 10)).toBe(5); // SW
    expect(sectorOf(-10, 0)).toBe(6); // W
    expect(sectorOf(-10, -10)).toBe(7); // NW
  });

  test("splits at about 22.5 degrees", () => {
    // tan(22.5) is about 0.414: 10 across and 4 up is still east.
    expect(sectorOf(10, -4)).toBe(2);
    expect(sectorOf(10, -5)).toBe(1);
  });
});

describe("WaveDirector", () => {
  test("the budget grows each wave and elites scale with it", () => {
    const d = new WaveDirector(OPTS, W);
    d.survey(edgeCells(), CENTRE, reachable());
    const plans = planWaves(d, new PseudoRandom(1), 3);
    expect(plans.map((p) => p.wave)).toEqual([1, 2, 3]);
    expect(plans.map((p) => p.budget)).toEqual([1_000, 1_500, 2_250]);
    expect(plans.map((p) => p.elites)).toEqual([10, 15, 22]);
    for (const p of plans) {
      expect(p.shamblers).toBe(p.budget - p.elites * OPTS.elitePoints);
    }
  });

  test("waves come from more directions over time and the last from all", () => {
    const d = new WaveDirector(OPTS, W);
    d.survey(edgeCells(), CENTRE, reachable());
    const plans = planWaves(d, new PseudoRandom(7), 8);
    expect(plans.map((p) => sectorsOf(p.sectors).length)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 8,
    ]);
    expect(plans.map((p) => p.final)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  test("the same seed gives the same waves", () => {
    const a = new WaveDirector(OPTS, W);
    const b = new WaveDirector(OPTS, W);
    a.survey(edgeCells(), CENTRE, reachable());
    b.survey(edgeCells(), CENTRE, reachable());
    expect(planWaves(a, new PseudoRandom(3), 8)).toEqual(
      planWaves(b, new PseudoRandom(3), 8),
    );
  });

  test("only directions with reachable spawn cells are picked", () => {
    const d = new WaveDirector({ ...OPTS, wavesPerDirection: 1 }, W);
    const dist = reachable();
    // Only the west edge is reachable.
    for (let y = 0; y < W; y++) {
      for (let x = 1; x < W; x++) dist[y * W + x] = UNREACHABLE;
    }
    d.survey(edgeCells(), CENTRE, dist);
    const plans = planWaves(d, new PseudoRandom(5), 4);
    for (const p of plans) {
      // SW, W and NW.
      for (const s of sectorsOf(p.sectors)) expect([5, 6, 7]).toContain(s);
    }
    // Even late waves can't ask for more directions than there are.
    expect(sectorsOf(plans[3].sectors)).toHaveLength(3);
  });

  test("emitters sit in the planned directions, away from the HQ", () => {
    const d = new WaveDirector(OPTS, W);
    d.survey(edgeCells(), CENTRE, reachable());
    const random = new PseudoRandom(11);
    const [plan] = planWaves(d, random, 1);
    const cells = d.emitterCells(plan, 6, random);
    expect(cells).toHaveLength(6);
    for (const c of cells) {
      const dx = (c % W) - 10;
      const dy = Math.floor(c / W) - 10;
      expect(plan.sectors & (1 << sectorOf(dx, dy))).not.toBe(0);
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(25);
    }
  });

  test("falls back to nearby cells when none are far enough", () => {
    const d = new WaveDirector({ ...OPTS, minSpawnDistance: 100 }, W);
    d.survey(edgeCells(), CENTRE, reachable());
    expect(d.availableSectors()).toBe(0xff);
  });
});
