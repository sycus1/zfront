import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import {
  decodeMapDistricts,
  districtMap,
} from "@openfront/engine-lib/game/Districts";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { Game, Player } from "@openfront/engine/game/Game";
import { BorderWalls } from "@openfront/engine/horde/BorderWalls";
import { Districts } from "@openfront/engine/horde/Districts";
import { FlowField, WALL_COST } from "@openfront/engine/horde/FlowField";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import { TOWN_HORDE_OPTIONS } from "@openfront/engine/horde/TownScale";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

// The "plains" test map is 100x100 tiles of open plains, 50x50 coarse
// cells, cut into 5x5 districts of about 10 cells. The survivor's HQ is at
// tile (50, 50); they start with its district and its neighbours, walled
// round. No wave comes.
const QUIET: Partial<HordeOptions> = {
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
  crateInterval: 0,
  outpostRadius: 6,
  buildingClaimRadius: 3,
  districtSize: 10,
  districtSecureTicks: 50,
  districtOverrunCount: 20,
  districtOverrunTicks: 30,
  districtCorePercent: 60,
  districtLand: 1,
  districtWalls: 1,
  wallHp: 400,
  stoneWallHp: 1_200,
  reinforcedWallHp: 3_000,
  spanCostPerCell: 1_000,
  stoneWallCostPerCell: 1_000,
  reinforcedWallCostPerCell: 2_000,
  wallClearRadius: 3,
  repairDelay: 50,
  repairInterval: 10,
  repairHp: 100,
  repairGoldPerHp: 1,
  hqHp: 10_000_000,
  pressureShift: 0,
};

const W = 50;

interface WallGame {
  game: Game;
  survivor: Player;
  horde: HordeExecution;
  districts: Districts;
  walls: BorderWalls;
}

async function wallGame(
  options: Partial<HordeOptions> = {},
  gold = 10_000_000n,
): Promise<WallGame> {
  const game = await setup("plains", { horde: true }, [
    new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
  ]);
  const survivor = game.player("survivor");
  survivor.conquer(game.ref(50, 50));
  survivor.setSpawnTile(game.ref(50, 50));
  survivor.addGold(gold);
  const horde = new HordeExecution({ ...QUIET, ...options });
  game.addExecution(horde);
  run(game, 20);
  const inner = horde as unknown as {
    districts: Districts;
    borderWalls: BorderWalls;
  };
  return {
    game,
    survivor,
    horde,
    districts: inner.districts,
    walls: inner.borderWalls,
  };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

function cell(x: number, y: number): number {
  return (y >> 1) * W + (x >> 1);
}

/** The top-left tile of coarse cell `c`. */
function tileOf(game: Game, c: number) {
  return game.ref((c % W) * 2, Math.floor(c / W) * 2);
}

/** A tile in the middle of district `d`'s cells. */
function tileIn(game: Game, districts: Districts, d: number) {
  const cells = districts.cellsOf(d);
  return tileOf(game, cells[cells.length >> 1]);
}

/** Whether district `d` is held by anyone. */
function held(districts: Districts, d: number): boolean {
  return districts.claimedBy(d) !== 0;
}

/** Cell `c`'s neighbours north, west, east and south, on the map. */
function sides(c: number): number[] {
  const x = c % W;
  const y = (c - x) / W;
  return [
    y > 0 ? c - W : -1,
    x > 0 ? c - 1 : -1,
    x + 1 < W ? c + 1 : -1,
    y + 1 < W ? c + W : -1,
  ].filter((n) => n >= 0);
}

/** Whether cell `c` is held land with a neighbour outside it. */
function onBorder(districts: Districts, c: number): boolean {
  return (
    held(districts, districts.districtOf(c)) &&
    sides(c).some((n) => !held(districts, districts.districtOf(n)))
  );
}

/** Cells of held land with a neighbour outside it, in cell order. */
function borderCells(districts: Districts): number[] {
  const out: number[] = [];
  for (let c = 0; c < W * W; c++) if (onBorder(districts, c)) out.push(c);
  return out;
}

/** Wall cells, standing or broken, in cell order. */
function wallCells(walls: BorderWalls): number[] {
  const out: number[] = [];
  for (let c = 0; c < W * W; c++) if (walls.isWall(c)) out.push(c);
  return out;
}

/**
 * Whether the horde could walk from the HQ out of the held land without
 * crossing a wall: 8-way, never cutting a corner past a wall, as the flow
 * field moves.
 */
function leaks(horde: HordeExecution, districts: Districts): boolean {
  const cost = (horde as unknown as { hordeFlow: FlowField }).hordeFlow.cost;
  const open = (c: number) => cost[c] !== 0 && cost[c] !== WALL_COST;
  const start = cell(50, 50);
  const seen = new Uint8Array(W * W);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const c = stack.pop()!;
    if (!held(districts, districts.districtOf(c))) return true;
    const x = c % W;
    const y = (c - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const n = ny * W + nx;
        if (seen[n] || !open(n)) continue;
        if (dx !== 0 && dy !== 0 && (!open(y * W + nx) || !open(ny * W + x))) {
          continue;
        }
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return false;
}

/** The home districts, and the first Wild district next to them. */
function layout(districts: Districts) {
  const home = districts.homeDistricts(cell(50, 50));
  const homeSet = new Set(home);
  const next = home
    .flatMap((d) => districts.map.neighbours[d])
    .filter((d) => !homeSet.has(d))
    .sort((a, b) => a - b)[0];
  // A home district with wall along its border (not the HQ's own).
  const edge = home.find((d) => d !== home[0])!;
  return { home, next, edge };
}

describe("Walls follow district borders", () => {
  test("walls stand on every open cell of the border, and nowhere else", async () => {
    const { horde, districts, walls } = await wallGame();
    const border = borderCells(districts);
    expect(border.length).toBeGreaterThan(20);
    expect(wallCells(walls)).toEqual(border);
    expect(walls.brokenCount()).toBe(0);
    // Drawn as barricades.
    const frame = horde.encodeFrame()!;
    for (const c of border) expect(frame.cells[c]).toBe(252);
    expect(horde.stats().borderWalls).toBe(border.length);
  });

  test("the walls seal the land: the horde can't get in without breaking one", async () => {
    const { horde, districts } = await wallGame();
    expect(leaks(horde, districts)).toBe(false);
  });

  test("with district walls off, there are none", async () => {
    const { horde, walls } = await wallGame({ districtWalls: 0 });
    expect(walls.standingCount()).toBe(0);
    expect(horde.stats().borderWalls).toBe(0);
  });

  test("taking a district moves the wall out, losing it brings the old line back", async () => {
    const { game, survivor, districts, walls } = await wallGame();
    const { next } = layout(districts);
    const before = wallCells(walls);
    const outpost = survivor.buildUnit(
      UnitType.Outpost,
      tileIn(game, districts, next),
      {},
    );
    run(game, 80);
    expect(held(districts, next)).toBe(true);
    // The wall now runs round the new district, and not between it and the
    // old land.
    const after = wallCells(walls);
    expect(after).toEqual(borderCells(districts));
    expect(after.some((c) => districts.districtOf(c) === next)).toBe(true);
    expect(before.some((c) => !walls.isWall(c))).toBe(true);
    outpost.delete(false);
    run(game, 10);
    expect(held(districts, next)).toBe(false);
    expect(wallCells(walls)).toEqual(before);
    expect(walls.brokenCount()).toBe(0);
  });

  test("the horde breaks a stretch of wall whole, and it's rebuilt for gold once clear", async () => {
    const { game, survivor, horde, districts, walls } = await wallGame();
    const { edge } = layout(districts);
    const wall = wallCells(walls).find(
      (c) => districts.districtOf(c) === edge,
    )!;
    // A crowd just outside it, heading for the HQ.
    const field = (horde as unknown as { field: HordeField }).field;
    const outside = sides(wall).find(
      (n) => !held(districts, districts.districtOf(n)),
    )!;
    expect(outside).toBeDefined();
    field.add(outside, 40);
    let broke = false;
    for (let t = 0; t < 200 && !broke; t++) {
      run(game, 1);
      broke = walls.brokenCount() > 0;
    }
    expect(broke).toBe(true);
    // A whole stretch goes at once: every broken cell's corner-to-corner
    // neighbours in the same district are broken too.
    for (const c of wallCells(walls)) {
      if (walls.isStanding(c)) continue;
      for (const n of [c - W - 1, c - W, c - W + 1, c - 1, c + 1, c + W - 1]) {
        if (n < 0 || !walls.isWall(n)) continue;
        if (Math.abs((n % W) - (c % W)) > 1) continue;
        if (districts.districtOf(n) !== districts.districtOf(c)) continue;
        expect(walls.isStanding(n)).toBe(false);
      }
    }
    const brokenCells = walls.brokenCount();
    // Once the horde is gone it goes back up, for 1,000 a cell.
    field.setDensity(new Uint16Array(W * W));
    const gold = survivor.gold();
    run(game, 70);
    expect(walls.brokenCount()).toBe(0);
    expect(gold - survivor.gold()).toBe(BigInt(brokenCells * 1_000));
  });

  test("a new wall can't go up on top of the horde", async () => {
    const { game, survivor, horde, districts, walls } = await wallGame();
    const { next } = layout(districts);
    const before = new Set(wallCells(walls));
    const outpost = survivor.buildUnit(
      UnitType.Outpost,
      tileIn(game, districts, next),
      {},
    );
    run(game, 80);
    // The old line, which goes back up when the district is lost, with a
    // crowd on one of its cells.
    const field = (horde as unknown as { field: HordeField }).field;
    const crowded = [...before].find((c) => !walls.isWall(c))!;
    expect(crowded).toBeDefined();
    field.add(crowded, 5);
    outpost.delete(false);
    run(game, 10);
    expect(walls.isWall(crowded)).toBe(true);
    expect(walls.isStanding(crowded)).toBe(false);
  });

  test("nothing else can be built on a wall", async () => {
    const { game, survivor, walls } = await wallGame();
    const wall = wallCells(walls)[0];
    expect(survivor.canBuild(UnitType.Mine, tileOf(game, wall))).toBe(false);
  });
});

describe("Upgrade walls", () => {
  test("raises a district's walls a tier, for each cell of wall it has", async () => {
    const { game, survivor, horde, districts, walls } = await wallGame();
    const { edge } = layout(districts);
    const tile = tileIn(game, districts, edge);
    const info = horde.districtWallsAt(survivor, tile)!;
    const cells = walls.wallCount(edge);
    expect(cells).toBeGreaterThan(0);
    expect(info).toEqual({
      tier: 1,
      cells,
      upgradeCost: BigInt(cells * 1_000),
    });
    const gold = survivor.gold();
    expect(horde.upgradeDistrictWalls(survivor, tile)).toBe(true);
    expect(gold - survivor.gold()).toBe(BigInt(cells * 1_000));
    expect(walls.tier(edge)).toBe(2);
    expect(horde.districtWallsAt(survivor, tile)!.upgradeCost).toBe(
      BigInt(cells * 2_000),
    );
    // Drawn as stone.
    const frame = horde.encodeFrame()!;
    const wall = wallCells(walls).find(
      (c) => districts.districtOf(c) === edge,
    )!;
    expect(frame.cells[wall]).toBe(253);
    expect(horde.upgradeDistrictWalls(survivor, tile)).toBe(true);
    expect(walls.tier(edge)).toBe(3);
    // Reinforced is the top.
    expect(horde.districtWallsAt(survivor, tile)!.upgradeCost).toBe(0n);
    expect(horde.upgradeDistrictWalls(survivor, tile)).toBe(false);
  });

  test("only on a district of yours with wall, and only if you can pay", async () => {
    const { game, survivor, horde, districts } = await wallGame({}, 0n);
    const { home, next, edge } = layout(districts);
    // The HQ's own district is all inside: no wall to raise.
    const hq = tileIn(game, districts, home[0]);
    expect(horde.districtWallsAt(survivor, hq)!.cells).toBe(0);
    survivor.addGold(10_000_000n);
    expect(horde.upgradeDistrictWalls(survivor, hq)).toBe(false);
    // Nor a district you don't hold.
    const wild = tileIn(game, districts, next);
    expect(horde.districtWallsAt(survivor, wild)).toBeNull();
    expect(horde.upgradeDistrictWalls(survivor, wild)).toBe(false);
    // Nor without the gold.
    survivor.removeGold(survivor.gold());
    expect(
      horde.upgradeDistrictWalls(survivor, tileIn(game, districts, edge)),
    ).toBe(false);
  });

  test("an upgrade_walls intent upgrades them, as a turn would", async () => {
    const { game, districts, walls } = await wallGame();
    const { edge } = layout(districts);
    const executor = new Executor(game, "game", "c1");
    game.addExecution(
      executor.createExec({
        type: "upgrade_walls",
        tile: tileIn(game, districts, edge),
        clientID: "c1",
      }),
    );
    run(game, 1);
    expect(walls.tier(edge)).toBe(2);
  });

  test("a district that is lost and taken back has barricades again", async () => {
    const { game, survivor, horde, districts, walls } = await wallGame();
    const { next } = layout(districts);
    const outpost = survivor.buildUnit(
      UnitType.Outpost,
      tileIn(game, districts, next),
      {},
    );
    run(game, 80);
    expect(
      horde.upgradeDistrictWalls(survivor, tileIn(game, districts, next)),
    ).toBe(true);
    expect(walls.tier(next)).toBe(2);
    outpost.delete(false);
    run(game, 10);
    expect(walls.tier(next)).toBe(1);
  });

  test("hand-built walls are off on town maps", () => {
    const config = (map: GameMapType, horde: boolean) =>
      new TestConfig(
        {
          gameMap: map,
          gameMapSize: GameMapSize.Normal,
          gameMode: GameMode.FFA,
          gameType: GameType.Singleplayer,
          difficulty: Difficulty.Medium,
          nations: "disabled",
          donateGold: false,
          donateTroops: false,
          bots: 0,
          infiniteGold: false,
          infiniteTroops: false,
          instantBuild: false,
          randomSpawn: false,
          horde,
        } satisfies GameConfig,
        false,
      );
    expect(config(GameMapType.Bath, true).isUnitDisabled(UnitType.Wall)).toBe(
      true,
    );
    expect(
      config(GameMapType.Britannia, true).isUnitDisabled(UnitType.Wall),
    ).toBe(false);
    expect(TOWN_HORDE_OPTIONS.districtWalls).toBe(1);
  });
});

describe("Border wall stretches", () => {
  // 8x4 cells: district 0 is the west half, 1 the east. Cells (3, 1) and
  // (4, 1) are blocked, so the wall down x = 3 is two stretches: (3, 0),
  // and (3, 2) with (3, 3).
  const own = decodeMapDistricts(
    { count: 2, rows: new Array(4).fill("0*4 1*4") },
    8,
    4,
  );
  const blocked = new Set([1 * 8 + 3, 1 * 8 + 4]);
  const make = () =>
    new BorderWalls(districtMap(8, 4, 10, own), 8, 4, (c) => !blocked.has(c));
  const westHeld = (d: number) => d === 0;

  test("open border cells of held districts, in stretches", () => {
    const walls = make();
    walls.update(westHeld, () => false, 0, 50);
    expect([3, 19, 27].every((c) => walls.isWall(c))).toBe(true);
    expect(walls.wallCount(0)).toBe(3);
    expect(walls.wallCount(1)).toBe(0);
    expect(walls.state().stretch).toEqual([0, 1, 1]);
  });

  test("a hit that breaks a stretch opens all of it, and only it", () => {
    const walls = make();
    walls.update(westHeld, () => false, 0, 50);
    const v = walls.stateVersion();
    expect(walls.hit(19, 399, 5, 400)).toBe(false);
    expect(walls.hit(27, 1, 6, 400)).toBe(true);
    expect(walls.isStanding(19)).toBe(false);
    expect(walls.isStanding(27)).toBe(false);
    expect(walls.isStanding(3)).toBe(true);
    expect(walls.stateVersion()).not.toBe(v);
  });

  test("a stretch keeps its damage when the border moves; new walls go up whole", () => {
    const walls = make();
    walls.update(westHeld, () => false, 0, 50);
    walls.hit(19, 100, 5, 400);
    // Open up row 1: the wall down x = 3 is one stretch now, (3, 1) new,
    // with the most damage of the two it joins.
    blocked.clear();
    walls.update(westHeld, () => false, 10, 50);
    expect(walls.state().stretch).toEqual([0, 0, 0, 0]);
    expect(walls.isStanding(11)).toBe(true);
    expect(walls.state().damage).toEqual([100]);
    // And broken if either of them was.
    walls.hit(3, 400, 11, 400);
    blocked.add(1 * 8 + 3).add(1 * 8 + 4);
    walls.update(westHeld, () => false, 20, 50);
    expect(walls.state().stretch).toEqual([0, 1, 1]);
    blocked.clear();
    walls.update(westHeld, () => false, 30, 50);
    expect(walls.isStanding(11)).toBe(false);
    expect(walls.state().damage).toEqual([0]);
    blocked.add(1 * 8 + 3).add(1 * 8 + 4);
  });

  test("a state round trip keeps stretches, damage and tiers", () => {
    const walls = make();
    walls.update(westHeld, () => false, 0, 50);
    walls.hit(19, 100, 5, 400);
    walls.upgrade(0);
    const copy = make();
    copy.restore(walls.state());
    expect(copy.state()).toEqual(walls.state());
    expect(copy.wallCount(0)).toBe(3);
    expect(copy.isWall(27)).toBe(true);
  });
});

describe("Border wall snapshots", () => {
  test("a snapshot restores walls, their damage and tiers", async () => {
    const { game, survivor, horde, districts, walls } = await wallGame();
    const { edge } = layout(districts);
    horde.upgradeDistrictWalls(survivor, tileIn(game, districts, edge));
    const wall = wallCells(walls).find(
      (c) => districts.districtOf(c) !== edge,
    )!;
    walls.hit(wall, 100, game.ticks(), 400);
    await expectSnapshotRoundTrip(game, "plains", 60);
  });

  test("a version 20 snapshot migrates with hand-built walls kept", () => {
    const v20 = { initialized: true, options: { districtLand: 1 }, wave: 1 };
    const v21 = HordeExecutionSnapshot.migrations[20](v20);
    expect(v21.options).toMatchObject({ districtLand: 1, districtWalls: 0 });
    expect(v21.borderWalls).toBeNull();
  });
});
