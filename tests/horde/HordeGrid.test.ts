import { Elites } from "@openfront/engine/horde/Elites";
import {
  downhill,
  FlowField,
  UNREACHABLE,
} from "@openfront/engine/horde/FlowField";
import { HordeField } from "@openfront/engine/horde/HordeField";

// Grids are drawn as text: "." plains (cost 1), "h" highland (cost 4),
// "#" blocked (mountain/water), "T" target (cost 1, flow source),
// "O" obstacle target (a structure: flow source that zombies can't enter),
// "Z" plains where a test drops zombies.
interface Grid {
  w: number;
  h: number;
  cost: Uint8Array;
  targets: number[];
  obstacles: number[];
  spawns: number[];
}

function grid(rows: string[]): Grid {
  const h = rows.length;
  const w = rows[0].length;
  const cost = new Uint8Array(w * h);
  const g: Grid = { w, h, cost, targets: [], obstacles: [], spawns: [] };
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`row ${y} has the wrong width`);
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      cost[i] = ch === "#" ? 0 : ch === "h" ? 4 : 1;
      if (ch === "T" || ch === "O") g.targets.push(i);
      if (ch === "O") g.obstacles.push(i);
      if (ch === "Z") g.spawns.push(i);
    });
  });
  return g;
}

function flowFor(g: Grid): FlowField {
  const f = new FlowField(g.w, g.h, g.cost);
  f.compute(g.targets);
  return f;
}

function fieldFor(g: Grid, cap = 60_000): HordeField {
  const field = new HordeField(g.w, g.h, cap);
  for (const o of g.obstacles) field.obstacle[o] = 1;
  return field;
}

describe("FlowField", () => {
  test("open plains: distance is the Manhattan distance", () => {
    const g = grid([".....", ".....", "..T..", ".....", "....."]);
    const f = flowFor(g);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(f.dist[y * 5 + x]).toBe(Math.abs(x - 2) + Math.abs(y - 2));
      }
    }
  });

  test("a ridge with one gap: the only way round is through the gap", () => {
    const g = grid([
      "...#...",
      "...#...",
      ".......", // the gap is at (3, 2)
      "...#...",
      "...#..T",
    ]);
    const f = flowFor(g);
    // (0, 0) must walk down to the gap row, through it, then on to (6, 4).
    expect(f.dist[0]).toBe(2 + 3 + 3 + 2);
    for (const ridge of [3, 10, 24, 31]) {
      expect(f.dist[ridge]).toBe(UNREACHABLE);
    }
  });

  test("a sealed pocket is unreachable", () => {
    const g = grid(["..#..", "..#.T", "..#.."]);
    const f = flowFor(g);
    expect(f.dist[0]).toBe(UNREACHABLE);
    expect(f.dist[8]).toBe(1);
  });

  test("a longer route over plains beats a short climb over highland", () => {
    const g = grid([
      ".....",
      ".hhh.", // straight across costs 4 per cell
      "Z...T",
    ]);
    // Bottom-row route: 4 plains steps. Through the highland would cost more.
    const f = flowFor(g);
    expect(f.dist[g.spawns[0]]).toBe(4);
    const g2 = grid(["#####", "Zhhh.", "####T"]);
    expect(flowFor(g2).dist[g2.spawns[0]]).toBe(4 + 4 + 4 + 1 + 1);
  });

  test("downhill breaks ties in N, E, S, W order", () => {
    const dist = Uint32Array.from([5, 3, 5, 3, 4, 3, 5, 3, 5]);
    expect(downhill(dist, 3, 3, 4)).toBe(1); // N wins over E, S, W at 3
    const noLower = Uint32Array.from([9, 9, 9, 9, 1, 9, 9, 9, 9]);
    expect(downhill(noLower, 3, 3, 4)).toBe(-1);
  });
});

describe("HordeField", () => {
  test("zombies flow to the target and none are lost", () => {
    const g = grid(["Z.........T"]);
    const field = fieldFor(g);
    field.add(g.spawns[0], 1000);
    const f = flowFor(g);
    for (let t = 0; t < 100; t++) field.step(f.dist);
    expect(field.total()).toBe(1000);
    expect(field.density[g.targets[0]]).toBe(1000);
  });

  test("a structure is never entered; blocked zombies press on it", () => {
    const g = grid(["Z....O"]);
    const field = fieldFor(g);
    field.add(g.spawns[0], 500);
    const f = flowFor(g);
    let pressure = 0;
    for (let t = 0; t < 80; t++) {
      field.step(f.dist);
      field.drainPressure((cell, p) => {
        expect(cell).toBe(g.obstacles[0]);
        pressure = p;
      });
      expect(field.density[g.obstacles[0]]).toBe(0);
    }
    // Everything has reached the cell next to the structure and leans on it.
    expect(field.density[4]).toBe(500);
    expect(pressure).toBe(500);
  });

  test("the horde funnels through the valley, never over the ridge", () => {
    const g = grid([
      "Z..#.....",
      "Z..#.....",
      "Z........", // the valley at (3, 2)
      "Z..#.....",
      "Z..#....T",
    ]);
    const field = fieldFor(g);
    for (const s of g.spawns) field.add(s, 400);
    const f = flowFor(g);
    let throughGap = 0;
    for (let t = 0; t < 60; t++) {
      field.step(f.dist);
      throughGap = Math.max(throughGap, field.density[2 * 9 + 3]);
      for (const ridge of [3, 12, 30, 39]) {
        expect(field.density[ridge]).toBe(0);
      }
    }
    expect(throughGap).toBeGreaterThan(0);
    expect(field.total()).toBe(2000);
  });

  test("cells never hold more than the cap", () => {
    const g = grid(["ZZZZT"]);
    const field = fieldFor(g, 300);
    for (const s of g.spawns) field.add(s, 300);
    expect(field.add(g.spawns[0], 1)).toBe(0);
    const f = flowFor(g);
    for (let t = 0; t < 20; t++) {
      field.step(f.dist);
      for (let i = 0; i < 5; i++) {
        expect(field.density[i]).toBeLessThanOrEqual(300);
      }
    }
    expect(field.total()).toBe(1200);
  });

  test("the same input gives the same result", () => {
    const rows = ["Z...#....", ".hh.#..h.", "....h....", "Z...#...T"];
    const run = () => {
      const g = grid(rows);
      const field = fieldFor(g, 700);
      for (const s of g.spawns) field.add(s, 650);
      const f = flowFor(g);
      for (let t = 0; t < 25; t++) field.step(f.dist);
      return Array.from(field.density);
    };
    expect(run()).toEqual(run());
  });
});

describe("Elites", () => {
  test("walk downhill at their speed and press on structures", () => {
    const g = grid(["Z...O"]);
    const field = fieldFor(g);
    const f = flowFor(g);
    const elites = new Elites(4, 1, 50);
    elites.spawn(g.spawns[0], 100);
    // Speed 1: a step every other tick.
    for (let t = 0; t < 6; t++) elites.step(field, f.dist);
    expect(elites.cell[0]).toBe(3);
    elites.step(field, f.dist);
    elites.step(field, f.dist);
    let pressure = 0;
    field.drainPressure((_, p) => (pressure = p));
    expect(pressure).toBe(50);
  });

  test("removeDead keeps survivors in order and clears the tail", () => {
    const elites = new Elites(3, 0, 0);
    elites.spawn(10, 5);
    elites.spawn(11, 0);
    elites.spawn(12, 7);
    expect(elites.removeDead()).toBe(1);
    expect(elites.count).toBe(2);
    expect(Array.from(elites.cell)).toEqual([10, 12, 0]);
    expect(Array.from(elites.hp)).toEqual([5, 7, 0]);
  });
});
