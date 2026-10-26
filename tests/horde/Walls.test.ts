import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import {
  downhill,
  FlowField,
  neighbours8,
  UNREACHABLE,
  WALL_COST,
} from "@openfront/engine/horde/FlowField";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// Grids are drawn as text: "." plains, "#" blocked, "T" target,
// "W" a wall (WALL_COST, an obstacle but not a target).
function grid(rows: string[]) {
  const h = rows.length;
  const w = rows[0].length;
  const cost = new Uint8Array(w * h);
  const targets: number[] = [];
  const walls: number[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      cost[i] = ch === "#" ? 0 : ch === "W" ? WALL_COST : 1;
      if (ch === "T") targets.push(i);
      if (ch === "W") walls.push(i);
    });
  });
  const flow = new FlowField(w, h, cost);
  flow.compute(targets);
  return { w, h, cost, targets, walls, flow };
}

function pathFrom(g: ReturnType<typeof grid>, from: number): number[] {
  const scratch = new Int32Array(8);
  const path = [from];
  for (let at = from; ;) {
    const next = downhill(g.flow.dist, g.cost, g.w, g.h, at, scratch);
    if (next < 0 || g.walls.includes(next)) return path;
    path.push(next);
    at = next;
  }
}

describe("walls in the flow field", () => {
  test("the flow goes round a wall through a gap", () => {
    const g = grid([
      "..T......",
      ".........",
      "WWWWWWW..",
      ".........",
      "..Z......",
    ]);
    const path = pathFrom(g, 4 * 9 + 2);
    expect(path[path.length - 1]).toBe(g.targets[0]);
    // It crosses row 2 through the gap, never through a wall.
    const crossing = path.find((c) => Math.floor(c / 9) === 2)!;
    expect(crossing % 9).toBeGreaterThanOrEqual(7);
  });

  test("a sealed target is still reachable, through the wall", () => {
    const g = grid([".......", ".WWW...", ".WTW...", ".WWW...", "......."]);
    const outside = 4 * 7 + 6;
    expect(g.flow.dist[outside]).not.toBe(UNREACHABLE);
    // Downhill from outside ends at the ring: the wall is the way in.
    const path = pathFrom(g, outside);
    const last = path[path.length - 1];
    const scratch = new Int32Array(8);
    const next = downhill(g.flow.dist, g.cost, g.w, g.h, last, scratch);
    expect(g.walls).toContain(next);
  });

  test("zombies can't slip diagonally between two walls", () => {
    const g = grid(["W.", ".W"]);
    const out = new Int32Array(8);
    const n = neighbours8(g.cost, g.w, g.h, 1, out);
    // From the top right cell: the walls below and to the left, no diagonal.
    expect([...out.subarray(0, n)].sort()).toEqual([0, 3]);
  });

  test("zombies blocked by a wall press on it", () => {
    const s = grid([".....", "WWWWW", "..T.."]);
    const field = new HordeField(s.w, s.h, s.cost, 1_000);
    for (const c of s.walls) field.obstacle[c] = 1;
    field.add(2, 400);
    field.step(s.flow.dist);
    const pressed: number[] = [];
    field.drainPressure((cell, p) => {
      expect(p).toBeGreaterThan(0);
      pressed.push(cell);
    });
    expect(pressed).toEqual([7]);
    expect(field.density[2]).toBe(400);
  });
});

const QUIET: Partial<HordeOptions> = { firstWaveDelay: 10_000 };

const SMALL_WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  waveInterval: 200,
  firstWaveSize: 4_000,
  emittersPerWave: 4,
  emitRate: 200,
  elitesPerWave: 0,
  structureHp: 600,
  pressureShift: 4,
};

/** A survivor owning tiles 40..59 square, a city at (50, 50) and the HQ. */
async function wallGame(
  options: Partial<HordeOptions>,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", {}, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 52));
  survivor.addGold(10_000_000n);
  survivor.buildUnit(UnitType.City, game.ref(50, 50), {});
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  return { game, horde };
}

/** Walls on every other tile round the square from (lo, lo) to (hi, hi). */
function ring(game: Game, lo: number, hi: number): void {
  const survivor = game.player("survivor");
  for (let k = lo; k <= hi; k += 2) {
    for (const [x, y] of [
      [k, lo],
      [k, hi],
      [lo, k],
      [hi, k],
    ]) {
      const tile = game.ref(x, y);
      if (survivor.canBuild(UnitType.Wall, tile) !== false) {
        survivor.buildUnit(UnitType.Wall, tile, {});
      }
    }
  }
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

describe("Wall unit", () => {
  test("is built on the player's own land, two tiles from anything else", async () => {
    const { game } = await wallGame(QUIET);
    const survivor = game.player("survivor");
    const at = (x: number, y: number) =>
      survivor.canBuild(UnitType.Wall, game.ref(x, y));
    expect(at(44, 44)).toBe(game.ref(44, 44));
    survivor.buildUnit(UnitType.Wall, game.ref(44, 44), {});
    expect(at(45, 44)).toBe(false);
    expect(at(45, 45)).toBe(false);
    expect(at(46, 44)).toBe(game.ref(46, 44));
    // Not next to the city, and not outside the territory.
    expect(at(51, 51)).toBe(false);
    expect(at(30, 30)).toBe(false);
  });

  test("a ring of walls keeps the horde off the city", async () => {
    const open = await wallGame(SMALL_WAVES);
    const walled = await wallGame({ ...SMALL_WAVES, wallHp: 10_000_000 });
    ring(walled.game, 44, 56);
    const walls = walled.game.player("survivor").units(UnitType.Wall).length;
    expect(walls).toBe(24);
    run(open.game, 150);
    run(walled.game, 150);
    expect(open.game.player("survivor").units(UnitType.City)).toHaveLength(0);
    const survivor = walled.game.player("survivor");
    expect(survivor.units(UnitType.City)).toHaveLength(1);
    expect(survivor.units(UnitType.Wall)).toHaveLength(walls);
    expect(walled.horde.stats().alive).toBeGreaterThan(0);
    expect(walled.horde.stats().hqHp).toBe(50_000);
  });

  test("weak walls fall to pressure and let the horde in", async () => {
    const { game, horde } = await wallGame({ ...SMALL_WAVES, wallHp: 300 });
    ring(game, 44, 56);
    const survivor = game.player("survivor");
    const walls = survivor.units(UnitType.Wall).length;
    run(game, 400);
    expect(survivor.units(UnitType.Wall).length).toBeLessThan(walls);
    expect(horde.stats().structuresDestroyed).toBeGreaterThan(0);
  });

  test("walls are obstacles but not targets", async () => {
    const { game, horde } = await wallGame(QUIET);
    game.player("survivor").buildUnit(UnitType.Wall, game.ref(42, 58), {});
    run(game, 3);
    const h = horde as unknown as {
      hordeFlow: FlowField;
      field: HordeField;
    };
    const cell = 29 * game.miniMap().width() + 21;
    expect(h.field.obstacle[cell]).toBe(1);
    expect(h.hordeFlow.dist[cell]).toBeGreaterThan(0);
    expect(h.hordeFlow.cost[cell]).toBe(WALL_COST);
  });

  test("the frame marks wall cells for the renderer", async () => {
    const { game, horde } = await wallGame(QUIET);
    game.player("survivor").buildUnit(UnitType.Wall, game.ref(42, 58), {});
    run(game, 3);
    const frame = horde.encodeFrame()!;
    expect(frame.cells[29 * frame.width + 21]).toBe(254);
  });

  test("a snapshot with walls under pressure restores identically", async () => {
    const { game } = await wallGame({ ...SMALL_WAVES, wallHp: 2_000 });
    ring(game, 44, 56);
    run(game, 60);
    await expectSnapshotRoundTrip(game, "plains", 40);
  });

  test("a version 2 snapshot migrates with the wave under way kept", () => {
    const v2 = {
      initialized: true,
      options: { elitesPerWave: 50 },
      wave: 3,
      waveSize: 45_000,
    };
    const v3 = HordeExecutionSnapshot.migrations[2](v2);
    expect(v3.options).toMatchObject({ elitePoints: 0, wallHp: 10_000 });
    expect(v3.currentPlan).toMatchObject({ wave: 3, budget: 45_000 });
    expect(v3.nextPlan).toBeNull();
    expect(v3.flowWalls).toEqual([]);
  });
});
