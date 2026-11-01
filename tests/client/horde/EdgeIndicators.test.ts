import { hordeDensityByte } from "@openfront/engine-lib/game/HordeCells";
import { describe, expect, it } from "vitest";
import {
  clampToRect,
  crateTargets,
  EdgeCamera,
  edgeMarkers,
  hordeClusters,
  hordeStrength,
  incomingTargets,
} from "../../../src/client/hud/layers/horde/EdgeIndicators";

const INSETS = { top: 10, right: 10, bottom: 10, left: 10 };

/** 1 px per tile, tile (0, 0) at the top-left of a 100×100 screen. */
const CAM: EdgeCamera = {
  scale: 1,
  originX: 0,
  originY: 0,
  width: 100,
  height: 100,
};

function frameCells(w: number, h: number, counts: Record<number, number>) {
  const cells = new Uint8Array(w * h);
  for (const [c, n] of Object.entries(counts)) {
    cells[Number(c)] = hordeDensityByte(n);
  }
  return { width: w, height: h, cells };
}

describe("hordeClusters", () => {
  it("sums zombies per block at their weighted centre, in tiles", () => {
    // 16×16 coarse cells, block 8: cells 0 and 1 share block 0.
    const f = frameCells(16, 16, { 0: 10, 1: 30, [16 * 9 + 9]: 5 });
    const c = hordeClusters(f, 8);
    expect(c.length).toBe(6);
    // Cell centres in tiles: x = 1 and 3, weighted 10 and 30.
    expect(c[0]).toBeCloseTo((1 * 10 + 3 * 30) / 40);
    expect(c[1]).toBeCloseTo(1);
    expect(c[2]).toBe(40);
    expect([c[3], c[4], c[5]]).toEqual([19, 19, 5]);
  });

  it("counts elites but not buildings or walls", () => {
    const cells = new Uint8Array(4);
    cells[0] = 255; // elite
    cells[1] = 248; // mine
    cells[2] = 252; // wall
    const c = hordeClusters({ width: 4, height: 1, cells }, 8);
    expect(Array.from(c)).toEqual([1, 1, 1]);
  });
});

describe("clampToRect", () => {
  it("stops the ray at the edge it crosses first", () => {
    expect(clampToRect(50, 50, 250, 50, 10, 10, 90, 90)).toEqual({
      x: 90,
      y: 50,
    });
    const p = clampToRect(50, 50, 150, -150, 10, 10, 90, 90);
    expect(p.y).toBeCloseTo(10);
    expect(p.x).toBeCloseTo(70);
  });

  it("leaves a target inside the rect where it is", () => {
    expect(clampToRect(50, 50, 60, 70, 10, 10, 90, 90)).toEqual({
      x: 60,
      y: 70,
    });
  });
});

describe("edgeMarkers", () => {
  it("shows nothing for what is on screen", () => {
    const clusters = new Float32Array([50, 50, 100]);
    const crates = [{ id: 1, x: 20, y: 20, gold: 500 }];
    expect(
      edgeMarkers(clusters, new Float32Array(0), crates, CAM, INSETS),
    ).toEqual([]);
  });

  it("merges off-screen zombies in one direction into one marker", () => {
    const clusters = new Float32Array([300, 48, 100, 300, 52, 50]);
    const m = edgeMarkers(clusters, new Float32Array(0), [], CAM, INSETS);
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe("horde");
    expect(m[0].amount).toBe(150);
    expect(m[0].x).toBeCloseTo(90);
    expect(m[0].y).toBeGreaterThan(45);
    expect(m[0].y).toBeLessThan(55);
    // Pans to the weighted centre, 200 tiles past the right edge.
    expect(m[0].tileX).toBeCloseTo(300);
    expect(m[0].distance).toBeCloseTo(200);
  });

  it("merges neighbouring directions whose markers would overlap", () => {
    // Just either side of the NE/E sector boundary, far off to the right.
    const clusters = new Float32Array([1000, -30, 50, 1000, -80, 50]);
    const m = edgeMarkers(clusters, new Float32Array(0), [], CAM, INSETS);
    expect(m).toHaveLength(1);
    expect(m[0].amount).toBe(100);
  });

  it("gives hordes on opposite sides their own markers", () => {
    const clusters = new Float32Array([-200, 50, 10, 300, 50, 400]);
    const m = edgeMarkers(clusters, new Float32Array(0), [], CAM, INSETS);
    expect(m.map((x) => Math.round(x.x)).sort()).toEqual([10, 90]);
    const big = m.find((x) => x.amount === 400)!;
    const small = m.find((x) => x.amount === 10)!;
    expect(big.strength).toBe(1);
    expect(small.strength).toBeLessThan(big.strength);
  });

  it("places one marker per off-screen crate and per landing direction", () => {
    const crates = [
      { id: 7, x: 50, y: -40, gold: 3500 },
      { id: 8, x: 50, y: 300, gold: 2000 },
    ];
    const incoming = new Float32Array([-100, 50, -100, 52]);
    const m = edgeMarkers(new Float32Array(0), incoming, crates, CAM, INSETS);
    const kinds = m.map((x) => x.kind).sort();
    expect(kinds).toEqual(["crate", "crate", "incoming"]);
    const top = m.find((x) => x.key === 7)!;
    expect(top.y).toBeCloseTo(10);
    expect(top.amount).toBe(3500);
    const left = m.find((x) => x.kind === "incoming")!;
    expect(left.x).toBeCloseTo(10);
  });

  it("follows the camera's zoom and pan", () => {
    // Zoomed in 4x on tile (100, 100): it sits at the screen centre.
    const cam = { ...CAM, scale: 4, originX: -350, originY: -350 };
    const near = edgeMarkers(
      new Float32Array([105, 105, 20]),
      new Float32Array(0),
      [],
      cam,
      INSETS,
    );
    expect(near).toEqual([]);
    const far = edgeMarkers(
      new Float32Array([200, 100, 20]),
      new Float32Array(0),
      [],
      cam,
      INSETS,
    );
    expect(far).toHaveLength(1);
    expect(far[0].x).toBeCloseTo(90);
  });
});

describe("frame readers", () => {
  it("reads crates as tiles", () => {
    const crates = new Int32Array([3, 2 * 100 + 7, 4000, 100, -1]);
    expect(crateTargets({ crates }, 100)).toEqual([
      { id: 3, x: 7, y: 2, gold: 4000 },
    ]);
  });

  it("only shows landings while the next wave counts down", () => {
    const f = {
      width: 10,
      outcome: "playing" as const,
      nextWave: 2,
      nextWaveIn: 100,
      clearing: false,
      nextWaveLandings: new Int32Array([10 * 3 + 4]),
    };
    expect(Array.from(incomingTargets(f))).toEqual([9, 7]);
    expect(incomingTargets({ ...f, clearing: true })).toHaveLength(0);
    expect(incomingTargets({ ...f, nextWave: 0 })).toHaveLength(0);
  });

  it("glows harder for bigger hordes, up to full", () => {
    expect(hordeStrength(1)).toBeLessThan(hordeStrength(100));
    expect(hordeStrength(10_000)).toBe(1);
  });
});
