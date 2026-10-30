import { hordeDensityByte } from "@openfront/engine-lib/game/HordeCells";
import { describe, expect, it } from "vitest";
import {
  HordeSwarm,
  SWARM_CELL_CAP,
  SWARM_DEATH_SEC,
  SWARM_FLOATS,
  SWARM_MAX_PARTICLES,
} from "../../../src/client/render/horde/HordeSwarm";

const W = 10;
const H = 10;

function cells(counts: Record<number, number>): Uint8Array {
  const out = new Uint8Array(W * H);
  for (const [c, n] of Object.entries(counts)) {
    out[Number(c)] = hordeDensityByte(n);
  }
  return out;
}

function perCell(swarm: HordeSwarm): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < swarm.count; i++) {
    const c = swarm.cellOf(i);
    out.set(c, (out.get(c) ?? 0) + 1);
  }
  return out;
}

function instances(swarm: HordeSwarm, now: number): Float32Array {
  const out = new Float32Array(swarm.maxInstances() * SWARM_FLOATS);
  const n = swarm.writeInstances(out, now);
  return out.subarray(0, n * SWARM_FLOATS);
}

describe("HordeSwarm", () => {
  it("draws one square per zombie in thin cells", () => {
    const swarm = new HordeSwarm();
    swarm.update(cells({ 11: 1, 12: 5, 55: 17 }), W, H, 0);
    expect(swarm.count).toBe(23);
    expect(perCell(swarm)).toEqual(
      new Map([
        [11, 1],
        [12, 5],
        [55, 17],
      ]),
    );
  });

  it("keeps each square inside its cell", () => {
    const swarm = new HordeSwarm();
    swarm.update(cells({ 23: 20 }), W, H, 0);
    const data = instances(swarm, 0);
    for (let o = 0; o < data.length; o += SWARM_FLOATS) {
      // Cell 23 is (3, 2), so tiles x 6-8 and y 4-6.
      expect(data[o + 2]).toBeGreaterThan(6);
      expect(data[o + 2]).toBeLessThan(8);
      expect(data[o + 3]).toBeGreaterThan(4);
      expect(data[o + 3]).toBeLessThan(6);
    }
  });

  it("walks squares into the next cell instead of making new ones", () => {
    const swarm = new HordeSwarm();
    swarm.update(cells({ 44: 10 }), W, H, 0);
    const before = instances(swarm, 0).slice();
    swarm.update(cells({ 44: 4, 45: 6 }), W, H, 0.3);
    expect(perCell(swarm)).toEqual(
      new Map([
        [44, 4],
        [45, 6],
      ]),
    );
    const after = instances(swarm, 0.3);
    let walking = 0;
    for (let i = 0; i < swarm.count; i++) {
      const o = i * SWARM_FLOATS;
      // No square is new: each was born on the first frame.
      expect(after[o + 5]).toBe(0);
      if (swarm.cellOf(i) === 45) {
        walking++;
        // It starts from where it stood in cell 44 (tiles x 8-10).
        expect(after[o]).toBeLessThan(10);
        expect(after[o + 2]).toBeGreaterThan(10);
      }
    }
    expect(walking).toBe(6);
    expect(before.length).toBe(10 * SWARM_FLOATS);
  });

  it("keeps a blob's squares when it moves several cells at once", () => {
    const swarm = new HordeSwarm();
    swarm.update(cells({ 41: 8, 42: 8 }), W, H, 0);
    swarm.update(cells({ 44: 8, 45: 8 }), W, H, 0.3);
    expect(perCell(swarm)).toEqual(
      new Map([
        [44, 8],
        [45, 8],
      ]),
    );
    const data = instances(swarm, 0.3);
    for (let o = 0; o < data.length; o += SWARM_FLOATS) {
      expect(data[o + 5]).toBe(0);
      expect(data[o + 6]).toBe(-1);
    }
  });

  it("leaves a fading mark for each zombie killed", () => {
    const swarm = new HordeSwarm();
    swarm.update(cells({ 44: 10 }), W, H, 0);
    swarm.update(cells({ 44: 7 }), W, H, 0.3);
    expect(swarm.count).toBe(7);
    const marks = (now: number) => {
      const data = instances(swarm, now);
      let n = 0;
      for (let o = 0; o < data.length; o += SWARM_FLOATS) {
        if (data[o + 6] >= 0) n++;
      }
      return n;
    };
    expect(marks(0.3)).toBe(3);
    expect(marks(0.31 + SWARM_DEATH_SEC)).toBe(0);
  });

  it("spawns squares for zombies coming ashore", () => {
    const swarm = new HordeSwarm();
    swarm.update(cells({}), W, H, 0);
    swarm.update(cells({ 0: 3, 99: 2 }), W, H, 1);
    expect(perCell(swarm)).toEqual(
      new Map([
        [0, 3],
        [99, 2],
      ]),
    );
  });

  it("caps packed cells", () => {
    const swarm = new HordeSwarm();
    swarm.update(cells({ 50: 2_000 }), W, H, 0);
    expect(swarm.count).toBe(SWARM_CELL_CAP);
    expect(swarm.cap).toBe(SWARM_CELL_CAP);
  });

  it("lowers the cap when the whole horde would not fit", () => {
    const w = 100;
    const h = 100;
    const grid = new Uint8Array(w * h).fill(hordeDensityByte(2_000));
    const swarm = new HordeSwarm();
    swarm.update(grid, w, h, 0);
    expect(swarm.cap).toBeLessThan(SWARM_CELL_CAP);
    expect(swarm.count).toBeLessThanOrEqual(SWARM_MAX_PARTICLES);
    expect(swarm.count).toBe(w * h * swarm.cap);
  });

  it("ignores buildings, walls and elites", () => {
    const swarm = new HordeSwarm();
    const grid = new Uint8Array(W * H);
    grid[1] = 248;
    grid[2] = 252;
    grid[3] = 255;
    swarm.update(grid, W, H, 0);
    expect(swarm.count).toBe(0);
  });

  it("does nothing when the cells have not changed", () => {
    const swarm = new HordeSwarm();
    const grid = cells({ 44: 10 });
    expect(swarm.update(grid, W, H, 0)).toBe(true);
    expect(swarm.update(grid.slice(), W, H, 0.1)).toBe(false);
    expect(swarm.update(cells({ 44: 9 }), W, H, 0.2)).toBe(true);
  });
});
