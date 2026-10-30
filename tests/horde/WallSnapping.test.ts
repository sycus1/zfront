import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import { FlowField, WALL_COST } from "@openfront/engine/horde/FlowField";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import {
  chooseLinks,
  lineCells,
  LinkGrid,
} from "@openfront/engine/horde/WallLinks";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// Grids are drawn as text: "." land a span may fill, "#" mountain,
// "~" water (neither), "P" an existing post, "N" the new post.
function linkGrid(rows: string[]) {
  const height = rows.length;
  const width = rows[0].length;
  const at = (c: number) => rows[Math.floor(c / width)][c % width];
  const posts: { cell: number; id: number }[] = [];
  let post = -1;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === "P") posts.push({ cell: y * width + x, id: posts.length + 1 });
      if (ch === "N") post = y * width + x;
    }),
  );
  const grid: LinkGrid = {
    width,
    height,
    isMountain: (c) => at(c) === "#",
    spannable: (c) => at(c) === ".",
  };
  return { grid, posts, post, cell: (x: number, y: number) => y * width + x };
}

describe("wall links", () => {
  test("lines are 8-connected and leave out their ends", () => {
    expect(lineCells(0, 4, 10)).toEqual([1, 2, 3]);
    expect(lineCells(0, 33, 10)).toEqual([11, 22]);
    expect(lineCells(4, 0, 10)).toEqual([3, 2, 1]);
    expect(lineCells(0, 1, 10)).toEqual([]);
    // A shallow line steps one row once.
    expect(lineCells(0, 14, 10)).toHaveLength(3);
  });

  test("a new post joins the nearest post, and one opposite it", () => {
    const g = linkGrid([
      "............",
      "..P...N...P.",
      "............",
      "......P.....",
    ]);
    const links = chooseLinks(g.post, g.posts, g.grid, 8);
    // The post below is nearest; the second must be roughly opposite it, so
    // neither post on the row qualifies.
    expect(links).toHaveLength(1);
    expect(links[0].post).toBe(3);
    expect(links[0].cells).toEqual([g.cell(6, 2)]);
  });

  test("a post dropped into a gap closes it on both sides", () => {
    const g = linkGrid(["P....N...P"]);
    const links = chooseLinks(g.post, g.posts, g.grid, 8);
    expect(links.map((l) => l.post)).toEqual([2, 1]);
    expect(links[0].cells).toEqual([6, 7, 8]);
    expect(links[1].cells).toEqual([4, 3, 2, 1]);
  });

  test("mountains anchor a span, and span over themselves for free", () => {
    const g = linkGrid(["...........", "#....N....#", "..........."]);
    const links = chooseLinks(g.post, g.posts, g.grid, 8);
    expect(links.map((l) => [l.post, l.anchor])).toEqual([
      [-1, g.cell(0, 1)],
      [-1, g.cell(10, 1)],
    ]);
    expect(links[0].cells).toHaveLength(4);
    expect(links[1].cells).toHaveLength(4);
  });

  test("a line over water, or beyond the radius, makes no link", () => {
    const g = linkGrid(["P.~.N........P"]);
    expect(chooseLinks(g.post, g.posts, g.grid, 8)).toEqual([]);
    expect(chooseLinks(g.post, g.posts, g.grid, 0)).toEqual([]);
  });
});

// No income, settling or free turret, so gold only moves when something
// is built.
const QUIET: Partial<HordeOptions> = {
  firstWaveDelay: 10_000,
  hqIncome: 0,
  settleCost: 0,
  startingTurrets: 0,
};

/** A survivor owning tiles 40..59 square, with the HQ at (50, 52). */
async function wallGame(
  options: Partial<HordeOptions> = QUIET,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde: true }, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 52));
  survivor.addGold(1_000_000n);
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  run(game, 1);
  return { game, horde };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

function wall(game: Game, x: number, y: number): void {
  const survivor = game.player("survivor");
  const tile = survivor.canBuild(UnitType.Wall, game.ref(x, y));
  expect(tile).not.toBe(false);
  survivor.buildUnit(UnitType.Wall, tile as number, {});
}

interface HordeInternals {
  hordeFlow: FlowField;
  field: HordeField;
  terrainCost: Uint8Array;
  spans: { cells: number[]; broken: boolean; damage: number }[];
  damageSpan(span: unknown, pressure: number): void;
}

const internals = (h: HordeExecution) => h as unknown as HordeInternals;

describe("wall spans", () => {
  test("walls and other horde buildings snap to the 2x2 build grid", async () => {
    const { game } = await wallGame();
    const survivor = game.player("survivor");
    expect(survivor.canBuild(UnitType.Wall, game.ref(45, 45))).toBe(
      game.ref(44, 44),
    );
    expect(survivor.canBuild(UnitType.Mine, game.ref(43, 46))).toBe(
      game.ref(42, 46),
    );
    const turret = survivor.canBuild(UnitType.DefensePost, game.ref(45, 47));
    expect(turret).not.toBe(false);
    expect(game.x(turret as number) % 2).toBe(0);
    expect(game.y(turret as number) % 2).toBe(0);
  });

  test("two posts in range are joined by a span that blocks like a wall", async () => {
    const { game, horde } = await wallGame();
    const survivor = game.player("survivor");
    wall(game, 42, 42);
    run(game, 1);
    const before = survivor.gold();
    wall(game, 54, 42);
    const postCost = before - survivor.gold();
    // Past the flow field's debounce.
    run(game, 15);
    // Cells (21, 21) and (27, 21): five cells between, at 1,000 gold each.
    expect(before - survivor.gold() - postCost).toBe(5_000n);
    const h = internals(horde);
    expect(h.spans).toHaveLength(1);
    const w = game.miniMap().width();
    const cells = [22, 23, 24, 25, 26].map((x) => 21 * w + x);
    expect(h.spans[0].cells).toEqual([...cells].reverse());
    for (const c of cells) {
      expect(h.field.obstacle[c]).toBe(1);
      expect(h.hordeFlow.cost[c]).toBe(WALL_COST);
    }
    const frame = horde.encodeFrame()!;
    for (const c of cells) expect(frame.cells[c]).toBe(252);
    // Nothing else may be built on the span.
    expect(survivor.canBuild(UnitType.Wall, game.ref(48, 42))).toBe(false);
  });

  test("the build preview shows the links and their price", async () => {
    const { game } = await wallGame();
    const survivor = game.player("survivor");
    wall(game, 42, 42);
    run(game, 2);
    const [wallBuild] = survivor.buildableUnits(game.ref(55, 43), [
      UnitType.Wall,
    ]);
    expect(wallBuild.canBuild).toBe(game.ref(54, 42));
    expect(wallBuild.wallLinks).toEqual([game.ref(54, 42), game.ref(42, 42)]);
    expect(wallBuild.wallLinkCost).toBe(5_000n);
  });

  test("a broken span opens, then is rebuilt once clear", async () => {
    const { game, horde } = await wallGame();
    const survivor = game.player("survivor");
    wall(game, 42, 42);
    wall(game, 54, 42);
    run(game, 3);
    const h = internals(horde);
    const span = h.spans[0];
    h.damageSpan(span, 1 << 30);
    expect(span.broken).toBe(true);
    run(game, 1);
    expect(h.field.obstacle[span.cells[0]]).toBe(0);
    // Both posts still stand.
    expect(survivor.units(UnitType.Wall)).toHaveLength(2);
    const gold = survivor.gold();
    run(game, 60);
    expect(span.broken).toBe(false);
    expect(h.field.obstacle[span.cells[0]]).toBe(1);
    expect(gold - survivor.gold()).toBeGreaterThanOrEqual(5_000n);
  });

  test("a span the owner can't afford yet goes up once they can", async () => {
    const { game, horde } = await wallGame();
    const survivor = game.player("survivor");
    wall(game, 42, 42);
    wall(game, 54, 42);
    survivor.removeGold(survivor.gold());
    run(game, 3);
    const h = internals(horde);
    expect(h.spans).toHaveLength(1);
    expect(h.spans[0].broken).toBe(true);
    expect(h.field.obstacle[h.spans[0].cells[0]]).toBe(0);
    survivor.addGold(5_000n);
    run(game, 10);
    expect(h.spans[0].broken).toBe(false);
    expect(survivor.gold()).toBe(0n);
  });

  test("walls can't go up in the face of the horde", async () => {
    const { game, horde } = await wallGame();
    const survivor = game.player("survivor");
    const h = internals(horde);
    const w = game.miniMap().width();
    // A few zombies at cell (24, 21): three cells clear is the limit.
    h.field.add(21 * w + 24, 5);
    expect(survivor.canBuild(UnitType.Wall, game.ref(42, 42))).toBe(false);
    expect(survivor.canBuild(UnitType.Wall, game.ref(40, 42))).toBe(
      game.ref(40, 42),
    );
    // Mines still can.
    expect(survivor.canBuild(UnitType.Mine, game.ref(46, 42))).toBe(
      game.ref(46, 42),
    );
  });

  test("a span near the horde waits until it has moved on", async () => {
    const { game, horde } = await wallGame();
    const survivor = game.player("survivor");
    const h = internals(horde);
    const w = game.miniMap().width();
    wall(game, 40, 42);
    wall(game, 56, 42);
    // Zombies just south of the gap, out of reach of both posts.
    h.field.add(24 * w + 24, 5);
    const gold = survivor.gold();
    run(game, 1);
    expect(h.spans).toHaveLength(1);
    expect(h.spans[0].broken).toBe(true);
    expect(survivor.gold()).toBe(gold);
    h.field.remove(24 * w + 24, 5);
    run(game, 10);
    expect(h.spans[0].broken).toBe(false);
    expect(gold - survivor.gold()).toBe(7_000n);
  });

  test("spans take their tier, and health, from the weaker post", async () => {
    const { game, horde } = await wallGame();
    wall(game, 42, 42);
    wall(game, 54, 42);
    run(game, 3);
    const h = internals(horde);
    const [a, b] = game.player("survivor").units(UnitType.Wall);
    a.increaseLevel();
    run(game, 1);
    // One post still a barricade: the span's 4,000 health breaks it.
    h.damageSpan(h.spans[0], 4_000 << 5);
    expect(h.spans[0].broken).toBe(true);
    run(game, 60);
    b.increaseLevel();
    run(game, 1);
    expect(horde.encodeFrame()!.cells[h.spans[0].cells[0]]).toBe(253);
    h.damageSpan(h.spans[0], 4_000 << 5);
    expect(h.spans[0].broken).toBe(false);
  });

  test("a span falls with either of its posts", async () => {
    const { game, horde } = await wallGame();
    wall(game, 42, 42);
    wall(game, 54, 42);
    run(game, 3);
    const h = internals(horde);
    const cell = h.spans[0].cells[0];
    game.player("survivor").units(UnitType.Wall)[0].delete(false);
    run(game, 1);
    expect(h.spans).toHaveLength(0);
    expect(h.field.obstacle[cell]).toBe(0);
  });

  test("a post next to a mountain anchors on it", async () => {
    const { game, horde } = await wallGame();
    const h = internals(horde);
    const w = game.miniMap().width();
    // A ridge down column 28 (tiles 56-57).
    for (let y = 18; y < 32; y++) h.terrainCost[y * w + 28] = 0;
    wall(game, 46, 42);
    run(game, 3);
    expect(h.spans).toHaveLength(1);
    expect(h.spans[0].cells).toEqual([24, 25, 26, 27].map((x) => 21 * w + x));
  });

  test("spans don't run through the HQ", async () => {
    const { game, horde } = await wallGame();
    // The HQ is at cell (25, 26); a line from (21, 26) to (29, 26) crosses it.
    wall(game, 42, 52);
    wall(game, 58, 52);
    run(game, 3);
    expect(internals(horde).spans).toHaveLength(0);
  });

  test("a snapshot with spans restores identically", async () => {
    const { game, horde } = await wallGame({
      firstWaveDelay: 1,
      waveInterval: 200,
      firstWaveSize: 4_000,
      emittersPerWave: 4,
      elitesPerWave: 0,
      wallHp: 500,
      pressureShift: 4,
      shamblerSpeed: 1,
    });
    for (const [x, y] of [
      [42, 42],
      [56, 42],
      [42, 56],
      [56, 56],
      [42, 48],
      [56, 48],
      [48, 42],
      [48, 56],
    ]) {
      wall(game, x, y);
    }
    run(game, 60);
    expect(internals(horde).spans.length).toBeGreaterThan(4);
    await expectSnapshotRoundTrip(game, "plains", 40);
  });

  test("a version 10 snapshot migrates with no snapping", () => {
    const v11 = HordeExecutionSnapshot.migrations[10]({
      options: { wallHp: 4_000 },
    });
    expect(v11.options).toMatchObject({
      wallClearRadius: 0,
      wallSnapRadius: 0,
      spanCostPerCell: 0,
    });
    expect(v11.spanIds).toEqual([]);
    expect(v11.linkedWalls).toEqual([]);
    expect(v11.nextSpanId).toBe(1);
  });
});
