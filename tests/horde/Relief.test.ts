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
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import {
  DistrictContents,
  DORMANT_HARBOUR,
  DORMANT_STATION,
} from "@openfront/engine/horde/DistrictContents";
import { Districts } from "@openfront/engine/horde/Districts";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import {
  nearestTile,
  nextReliefWave,
  reliefAfter,
  ReliefOptions,
} from "@openfront/engine/horde/Relief";
import {
  hordeOptionsForMap,
  TOWN_HORDE_OPTIONS,
} from "@openfront/engine/horde/TownScale";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The "plains" test map is 100x100 tiles of open plains, 50x50 coarse
// cells, cut into 5x5 districts of about 10 cells. The survivor's HQ is at
// tile (50, 50); they start with its district and its neighbours. The
// map's railway station is in a district two rings out, which they take
// with an Outpost. No wave comes, and the districts hold nothing else.
const QUIET: Partial<HordeOptions> = {
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
  crateInterval: 0,
  districtSize: 10,
  districtSecureTicks: 50,
  districtOverrunCount: 20,
  districtOverrunTicks: 30,
  districtCorePercent: 60,
  districtLand: 1,
  districtWalls: 0,
  hqHp: 10_000_000,
  pressureShift: 0,
  districtContents: 1,
  cacheGoldPerRing: 0,
  survivorsPerRing: 0,
  dormantCities: 0,
  dormantFactories: 0,
  dormantSilos: 0,
  factoryIncome: 0,
  populationTax: 0,
  reliefEvery: 4,
  reliefSurvivors: 40_000,
  reliefGold: 25_000,
};

const W = 50;

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

function cell(x: number, y: number): number {
  return (y >> 1) * W + (x >> 1);
}

function tileOf(game: Game, c: number) {
  return game.ref((c % W) * 2, Math.floor(c / W) * 2);
}

interface Inner {
  districts: Districts;
  contents: DistrictContents;
  field: { add(cell: number, n: number): void };
  survived(wave: number): void;
}

function inner(horde: HordeExecution): Inner {
  return horde as unknown as Inner;
}

/** The plains game, with the station in district `far` two rings out. */
async function stationGame(options: Partial<HordeOptions> = {}): Promise<{
  game: Game;
  survivor: Player;
  horde: HordeExecution;
  far: number;
  station: { x: number; y: number };
}> {
  // Find a district two rings out first, on a game of its own.
  const probe = await plainsGame({});
  const { districts, contents } = inner(probe.horde);
  const ring = contents.rings(districts.homeDistricts(cell(50, 50)));
  const far = [...ring.keys()].find((d) => ring[d] === 2)!;
  const cells = districts.cellsOf(far);
  const c = cells[cells.length >> 1];
  const station = { x: (c % W) * 2, y: Math.floor(c / W) * 2 };
  const g = await plainsGame({
    reliefStationX: station.x,
    reliefStationY: station.y,
    ...options,
  });
  return { ...g, far, station };
}

async function plainsGame(options: Partial<HordeOptions>): Promise<{
  game: Game;
  survivor: Player;
  horde: HordeExecution;
}> {
  const game = await setup("plains", { horde: true }, [
    new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
  ]);
  const survivor = game.player("survivor");
  survivor.conquer(game.ref(50, 50));
  survivor.setSpawnTile(game.ref(50, 50));
  survivor.addGold(100_000_000n);
  const horde = new HordeExecution({ ...QUIET, ...options });
  game.addExecution(horde);
  run(game, 20);
  return { game, survivor, horde };
}

/** Takes district `d` with an Outpost and waits for it to be secured. */
function capture(
  game: Game,
  survivor: Player,
  horde: HordeExecution,
  d: number,
) {
  const { districts } = inner(horde);
  const cells = districts.cellsOf(d);
  survivor.buildUnit(UnitType.Outpost, tileOf(game, cells[0]), {});
  run(game, 80);
  expect(districts.claimedBy(d)).toBe(survivor.smallID());
}

/** People a game with no station gains when wave `wave` is survived. */
async function refugeesAfter(wave: number): Promise<number> {
  const { survivor, horde } = await plainsGame({});
  for (let w = 1; w < wave; w++) inner(horde).survived(w);
  const before = survivor.troops();
  inner(horde).survived(wave);
  return survivor.troops() - before;
}

function stationUnit(survivor: Player): Unit | undefined {
  return survivor.units(UnitType.Factory)[0];
}

describe("Relief helpers", () => {
  const opts = (reliefEvery: number) =>
    ({ reliefEvery }) as unknown as ReliefOptions;

  test("relief comes after every fourth wave", () => {
    expect(
      [1, 2, 3, 4, 5, 8, 12].filter((w) => reliefAfter(opts(4), w)),
    ).toEqual([4, 8, 12]);
    expect(reliefAfter(opts(0), 4)).toBe(false);
    expect(nextReliefWave(opts(4), 0)).toBe(4);
    expect(nextReliefWave(opts(4), 3)).toBe(4);
    expect(nextReliefWave(opts(4), 4)).toBe(8);
    expect(nextReliefWave(opts(0), 4)).toBe(0);
  });

  test("the nearest tile that will do, or none", () => {
    const ok = (x: number, y: number) => x >= 10 && y === 5;
    expect(nearestTile(3, 5, 8, 20, 20, ok)).toEqual({ x: 10, y: 5 });
    expect(nearestTile(3, 5, 6, 20, 20, ok)).toBeNull();
    expect(nearestTile(12, 5, 3, 20, 20, ok)).toEqual({ x: 12, y: 5 });
  });
});

describe("Relief at a held station", () => {
  test("the station lies dormant until its district is taken, then wakes as a Factory", async () => {
    const { game, survivor, horde, far, station } = await stationGame();
    const { contents } = inner(horde);
    const held = contents.contentsOf(far);
    expect(held.kind).toBe(DORMANT_STATION);
    expect(held.awake).toBe(false);
    // On the station's own spot.
    expect(game.x(held.site)).toBe(station.x);
    expect(game.y(held.site)).toBe(station.y);
    expect(stationUnit(survivor)).toBeUndefined();

    capture(game, survivor, horde, far);
    expect(contents.contentsOf(far).awake).toBe(true);
    const u = stationUnit(survivor)!;
    expect(u.tile()).toBe(held.site);
    // The frame says when relief comes next.
    expect(horde.encodeFrame()!.reliefWave).toBe(4);
  });

  test("a held station brings people and gold after every fourth wave", async () => {
    const { game, survivor, horde, far } = await stationGame();
    capture(game, survivor, horde, far);
    const h = inner(horde);
    const gold = survivor.gold();
    h.survived(1);
    h.survived(2);
    h.survived(3);
    expect(survivor.gold()).toBe(gold);
    expect(horde.stats().reliefs).toBe(0);
    // Refugees come after every wave too; the relief is on top of them.
    const people = survivor.troops();
    const refugees = await refugeesAfter(4);
    h.survived(4);
    expect(survivor.gold()).toBe(gold + 25_000n);
    expect(survivor.troops()).toBe(
      Math.min(people + refugees + 40_000, game.config().maxTroops(survivor)),
    );
    expect(horde.stats().reliefs).toBe(1);
    expect(horde.encodeFrame()!.reliefWave).toBe(8);
    // Each wave counts once.
    h.survived(4);
    expect(horde.stats().reliefs).toBe(1);
  });

  test("a wrecked station misses its relief and is rebuilt after the clear", async () => {
    const { game, survivor, horde, far } = await stationGame();
    capture(game, survivor, horde, far);
    const h = inner(horde);
    stationUnit(survivor)!.delete(false);
    run(game, 15);
    expect(h.contents.contentsOf(far).awake).toBe(false);
    for (let w = 1; w <= 3; w++) h.survived(w);
    run(game, 15);
    expect(h.contents.contentsOf(far).awake).toBe(true);
    expect(stationUnit(survivor)).toBeDefined();
    stationUnit(survivor)!.delete(false);
    run(game, 15);
    const gold = survivor.gold();
    h.survived(4);
    expect(survivor.gold()).toBe(gold);
    expect(horde.stats().reliefs).toBe(0);
    run(game, 15);
    expect(stationUnit(survivor)).toBeDefined();
  });

  test("an unheld station brings nothing", async () => {
    const { survivor, horde } = await stationGame();
    const gold = survivor.gold();
    inner(horde).survived(4);
    expect(survivor.gold()).toBe(gold);
    expect(horde.stats().reliefs).toBe(0);
  });

  test("a station in the starting districts is awake from the start", async () => {
    const { survivor, horde } = await plainsGame({
      reliefStationX: 50,
      reliefStationY: 56,
    });
    const { contents, districts } = inner(horde);
    const d = districts.districtOf(cell(50, 56));
    expect(districts.isCore(d)).toBe(true);
    expect(contents.contentsOf(d).kind).toBe(DORMANT_STATION);
    expect(contents.contentsOf(d).awake).toBe(true);
    expect(stationUnit(survivor)).toBeDefined();
  });

  test("with relief off, or no station, the frame shows none", async () => {
    const none = await plainsGame({});
    expect(inner(none.horde).contents.hasRelief()).toBe(false);
    expect(none.horde.encodeFrame()!.reliefWave).toBe(0);
    // Plains has no sea, so a harbour finds no shore.
    const dry = await plainsGame({ reliefHarbourX: 50, reliefHarbourY: 80 });
    expect(inner(dry.horde).contents.hasRelief()).toBe(false);
  });

  test("a snapshot keeps the station and the relief count", async () => {
    const { game, survivor, horde, far } = await stationGame();
    capture(game, survivor, horde, far);
    inner(horde).survived(4);
    run(game, 1);
    await expectSnapshotRoundTrip(game, "plains", 100);
  });

  test("a version 23 snapshot migrates with no relief", () => {
    const v23 = { initialized: true, options: { railWreck: 1 }, wave: 1 };
    const v24 = HordeExecutionSnapshot.migrations[23](v23);
    expect(v24.options).toMatchObject({ railWreck: 1, reliefEvery: 0 });
    expect(v24.reliefs).toBe(0);
  });
});

describe("Town stations and harbours", () => {
  test("every town names a station, and relief comes every fourth wave", () => {
    expect(TOWN_HORDE_OPTIONS.reliefEvery).toBe(4);
    for (const map of [
      GameMapType.Bath,
      GameMapType.Sheffield,
      GameMapType.Whitby,
    ]) {
      expect(hordeOptionsForMap(map).reliefStationX).toBeGreaterThanOrEqual(0);
    }
  });

  test("Whitby's harbour is on the Esk's shore and wakes as a Port", async () => {
    const config: GameConfig = {
      gameMap: GameMapType.Whitby,
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
      horde: true,
    };
    const loader = new NodeGameMapLoader(
      path.join(__dirname, "../../resources/maps"),
    );
    const terrain = await loadTerrainMap(
      await loadMapFiles(loader, GameMapType.Whitby, GameMapSize.Normal),
    );
    const game = createGame(
      [],
      [],
      terrain.gameMap,
      terrain.miniGameMap,
      new EngineConfig(config, false),
      terrain.teamGameSpawnAreas,
      terrain.districts,
    );
    // An HQ up the harbour side, so the harbour is in its starting ground.
    const info = new PlayerInfo("survivor", PlayerType.Human, null, "survivor");
    game.addExecution(new SpawnExecution("seed", info, game.ref(200, 200)));
    while (game.inSpawnPhase()) game.executeNextTick();
    const horde = new HordeExecution(hordeOptionsForMap(GameMapType.Whitby));
    game.addExecution(horde);
    run(game, 20);
    const { contents, districts } = inner(horde);
    const survivor = game.player("survivor");
    const sites = [...Array(districts.map.count).keys()]
      .map((d) => contents.contentsOf(d))
      .filter((c) => c.kind === DORMANT_HARBOUR || c.kind === DORMANT_STATION);
    expect(sites.map((s) => s.kind).sort()).toEqual([
      DORMANT_STATION,
      DORMANT_HARBOUR,
    ]);
    const harbour = sites.find((s) => s.kind === DORMANT_HARBOUR)!;
    expect(game.isOceanShore(harbour.site)).toBe(true);
    expect(harbour.awake).toBe(true);
    const port = survivor.units(UnitType.Port)[0];
    expect(port.tile()).toBe(harbour.site);
    // Relief comes in by boat.
    const gold = survivor.gold();
    inner(horde).survived(4);
    expect(survivor.gold()).toBe(gold + 25_000n);
    expect(horde.stats().reliefs).toBe(1);
  });
});
