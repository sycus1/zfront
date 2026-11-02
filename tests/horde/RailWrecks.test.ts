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
import { CityExecution } from "@openfront/engine/execution/CityExecution";
import { FactoryExecution } from "@openfront/engine/execution/FactoryExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { Railroad } from "@openfront/engine/game/Railroad";
import { DistrictContents } from "@openfront/engine/horde/DistrictContents";
import { Districts } from "@openfront/engine/horde/Districts";
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
// tile (50, 50); they start with its district and its neighbours, take one
// more district two rings out with an Outpost, and run a railway from a
// Factory at home to a City there, through the wild ring between. No wave
// comes.
const QUIET: Partial<HordeOptions> = {
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
  crateInterval: 0,
  districtSize: 10,
  districtSecureTicks: 50,
  districtOverrunCount: 1_000,
  districtOverrunTicks: 30,
  districtCorePercent: 60,
  districtLand: 1,
  districtWalls: 0,
  hqHp: 10_000_000,
  pressureShift: 0,
  railWreck: 1,
  railWreckCount: 3,
  railRepairTicks: 300,
};

const W = 50;

interface RailGame {
  game: Game;
  survivor: Player;
  horde: HordeExecution;
  districts: Districts;
  field: HordeField;
  factory: Unit;
  city: Unit;
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

function cell(x: number, y: number): number {
  return (y >> 1) * W + (x >> 1);
}

function tileOf(game: Game, c: number) {
  return game.ref((c % W) * 2, Math.floor(c / W) * 2);
}

async function railGame(
  options: Partial<HordeOptions> = {},
): Promise<RailGame> {
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
  const inner = horde as unknown as {
    districts: Districts;
    contents: DistrictContents;
    field: HordeField;
  };
  const districts = inner.districts;
  // A district two rings out, as near the HQ's row as there is.
  const ring = inner.contents.rings(districts.homeDistricts(cell(50, 50)));
  const far = [...ring.keys()]
    .filter((d) => ring[d] === 2)
    .sort(
      (a, b) =>
        Math.abs(Math.floor(districts.cellsOf(a)[0] / W) - 25) -
        Math.abs(Math.floor(districts.cellsOf(b)[0] / W) - 25),
    )[0];
  const cells = districts.cellsOf(far);
  survivor.buildUnit(UnitType.Outpost, tileOf(game, cells[0]), {});
  run(game, 80);
  expect(districts.claimedBy(far)).toBe(survivor.smallID());
  const city = survivor.buildUnit(
    UnitType.City,
    tileOf(game, cells[cells.length - 1]),
    {},
  );
  game.addExecution(new CityExecution(city));
  const factory = survivor.buildUnit(UnitType.Factory, game.ref(50, 46), {});
  game.addExecution(new FactoryExecution(factory));
  run(game, 5);
  return {
    game,
    survivor,
    horde,
    districts,
    field: inner.field,
    factory,
    city,
  };
}

/** Every railroad in the network, once each. */
function rails(game: Game): Railroad[] {
  const out: Railroad[] = [];
  for (const s of game.railNetwork().stationManager().getAll()) {
    for (const r of s.getRailroads()) if (r.from === s) out.push(r);
  }
  return out;
}

/** The coarse cells of `rail`, in or out of held ground. */
function railCells(r: RailGame, rail: Railroad, held: boolean): number[] {
  const id = r.survivor.smallID();
  return [
    ...new Set(rail.tiles.map((t) => cell(r.game.x(t), r.game.y(t)))),
  ].filter(
    (c) => (r.districts.claimedBy(r.districts.districtOf(c)) === id) === held,
  );
}

describe("Railways through the wild", () => {
  test("the horde wrecks track outside held ground, and it's relaid once clear", async () => {
    const r = await railGame();
    expect(rails(r.game)).toHaveLength(1);
    const wild = railCells(r, rails(r.game)[0], false);
    expect(wild.length).toBeGreaterThan(0);
    r.field.add(wild[wild.length >> 1], 20);
    run(r.game, 10);
    expect(rails(r.game)).toHaveLength(0);
    expect(r.horde.stats()).toMatchObject({ railsWrecked: 1, railsBroken: 1 });
    // The horde moves on: 30 seconds later the line is back.
    r.field.setDensity(new Uint16Array(W * W));
    run(r.game, 200);
    expect(rails(r.game)).toHaveLength(0);
    run(r.game, 130);
    expect(rails(r.game)).toHaveLength(1);
    expect(r.horde.stats().railsBroken).toBe(0);
  });

  test("track inside held ground is safe", async () => {
    const r = await railGame();
    const held = railCells(r, rails(r.game)[0], true);
    expect(held.length).toBeGreaterThan(0);
    r.field.add(held[0], 20);
    run(r.game, 10);
    expect(rails(r.game)).toHaveLength(1);
    expect(r.horde.stats().railsWrecked).toBe(0);
  });

  test("a few zombies aren't enough", async () => {
    const r = await railGame({ railWreckCount: 1_000 });
    const wild = railCells(r, rails(r.game)[0], false);
    r.field.add(wild[0], 20);
    run(r.game, 10);
    expect(rails(r.game)).toHaveLength(1);
  });

  test("with railway wrecking off, the horde leaves track alone", async () => {
    const r = await railGame({ railWreck: 0 });
    const wild = railCells(r, rails(r.game)[0], false);
    r.field.add(wild[0], 20);
    run(r.game, 10);
    expect(rails(r.game)).toHaveLength(1);
  });

  test("a wrecked line whose station is gone isn't relaid", async () => {
    const r = await railGame();
    const wild = railCells(r, rails(r.game)[0], false);
    r.field.add(wild[0], 20);
    run(r.game, 10);
    r.city.delete(false);
    r.field.setDensity(new Uint16Array(W * W));
    run(r.game, 400);
    expect(rails(r.game)).toHaveLength(0);
    expect(r.horde.stats().railsBroken).toBe(0);
  });

  test("a snapshot restores a wrecked line waiting to be relaid", async () => {
    const r = await railGame();
    const wild = railCells(r, rails(r.game)[0], false);
    r.field.add(wild[0], 20);
    run(r.game, 10);
    r.field.setDensity(new Uint16Array(W * W));
    run(r.game, 20);
    await expectSnapshotRoundTrip(r.game, "plains", 400);
  });

  test("a version 22 snapshot migrates with railways left alone", () => {
    const v22 = { initialized: true, options: { districtLand: 1 }, wave: 1 };
    const v23 = HordeExecutionSnapshot.migrations[22](v22);
    expect(v23.options).toMatchObject({ districtLand: 1, railWreck: 0 });
    expect(v23.rails).toBeNull();
  });
});

describe("Captured-only buildings on town maps", () => {
  const config = (map: GameMapType) =>
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
        horde: true,
      } satisfies GameConfig,
      false,
    );

  test("Cities, Factories and Ports can't be built by hand on towns", () => {
    const bath = config(GameMapType.Bath);
    for (const t of [UnitType.City, UnitType.Factory, UnitType.Port]) {
      expect(bath.capturedOnly(t)).toBe(true);
      expect(bath.isUnitDisabled(t)).toBe(true);
      expect(config(GameMapType.Britannia).isUnitDisabled(t)).toBe(false);
    }
    // The mortar is still built by hand; a captured Silo is extra.
    expect(bath.capturedOnly(UnitType.MissileSilo)).toBe(false);
    expect(bath.isUnitDisabled(UnitType.MissileSilo)).toBe(false);
    expect(TOWN_HORDE_OPTIONS.railWreck).toBe(1);
  });

  test("a train stop pays a town-sized sum on towns", async () => {
    const game = await setup("plains", { horde: true }, [
      new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
    ]);
    const p = game.player("survivor");
    expect(config(GameMapType.Bath).trainGold("self", 3, p)).toBe(1_000n);
    expect(config(GameMapType.Britannia).trainGold("self", 3, p)).toBe(10_000n);
  });
});
