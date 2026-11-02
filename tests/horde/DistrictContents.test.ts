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
import { DistrictMap } from "@openfront/engine-lib/game/Districts";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Game, Player } from "@openfront/engine/game/Game";
import {
  DistrictContentOptions,
  DistrictContents,
  DORMANT_CITY,
  DORMANT_FACTORY,
  DORMANT_NONE,
  DORMANT_SILO,
} from "@openfront/engine/horde/DistrictContents";
import { Districts } from "@openfront/engine/horde/Districts";
import { payHqIncome } from "@openfront/engine/horde/Economy";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { TOWN_HORDE_OPTIONS } from "@openfront/engine/horde/TownScale";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

// The "plains" test map is 100x100 tiles of open plains, 50x50 coarse
// cells, cut into 5x5 districts of about 10 cells. The survivor's HQ is at
// tile (50, 50); they start with its district and its neighbours, and the
// districts round them (ring 1) hold things. No wave comes.
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
  districtWalls: 1,
  hqHp: 10_000_000,
  pressureShift: 0,
  districtContents: 1,
  cacheGoldPerRing: 5_000,
  cachePercent: 100,
  survivorsPerRing: 20_000,
  contentMaxRing: 4,
  dormantCities: 1,
  dormantFactories: 1,
  dormantSilos: 1,
  // The map is only two rings deep round the start, so buildings may go
  // in ring 1 and the Silo one further out.
  dormantMinRing: 0,
  contentMinCells: 12,
  siloBonusLevels: 2,
  startingPopulation: 100_000,
};

const W = 50;

interface ContentsGame {
  game: Game;
  survivor: Player;
  horde: HordeExecution;
  districts: Districts;
  contents: DistrictContents;
}

async function contentsGame(
  options: Partial<HordeOptions> = {},
): Promise<ContentsGame> {
  const game = await setup("plains", { horde: true }, [
    new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
  ]);
  const survivor = game.player("survivor");
  survivor.conquer(game.ref(50, 50));
  survivor.setSpawnTile(game.ref(50, 50));
  survivor.addGold(10_000_000n);
  const horde = new HordeExecution({ ...QUIET, ...options });
  game.addExecution(horde);
  run(game, 20);
  const inner = horde as unknown as {
    districts: Districts;
    contents: DistrictContents;
  };
  return {
    game,
    survivor,
    horde,
    districts: inner.districts,
    contents: inner.contents,
  };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

function cell(x: number, y: number): number {
  return (y >> 1) * W + (x >> 1);
}

/** A tile in the middle of district `d`'s cells. */
function tileIn(game: Game, districts: Districts, d: number) {
  const cells = districts.cellsOf(d);
  const c = cells[cells.length >> 1];
  return game.ref((c % W) * 2, Math.floor(c / W) * 2);
}

/** The districts outside the start, in id order. */
function outside(districts: Districts): number[] {
  const home = new Set(districts.homeDistricts(cell(50, 50)));
  const out: number[] = [];
  for (let d = 0; d < districts.map.count; d++) if (!home.has(d)) out.push(d);
  return out;
}

/** The first district outside the start with a building of `kind`. */
function districtWith(
  districts: Districts,
  contents: DistrictContents,
  kind: number,
): number {
  return outside(districts).find((d) => contents.contentsOf(d).kind === kind)!;
}

/**
 * Takes district `d` with an Outpost, which costs nothing here, and waits
 * for it to be secured.
 */
function capture(c: ContentsGame, d: number) {
  const cost = c.game.unitInfo(UnitType.Outpost).cost(c.game, c.survivor);
  const outpost = c.survivor.buildUnit(
    UnitType.Outpost,
    tileIn(c.game, c.districts, d),
    {},
  );
  c.survivor.addGold(cost);
  run(c.game, 80);
  expect(c.districts.claimedBy(d)).toBe(c.survivor.smallID());
  return outpost;
}

/** The survivor's active units of `type` on tile `tile`. */
function unitsAt(p: Player, type: UnitType, tile: number) {
  return p.units(type).filter((u) => u.isActive() && u.tile() === tile);
}

describe("What districts hold", () => {
  test("districts outside the start hold cash, survivors and buildings; the start holds none", async () => {
    const { districts, contents } = await contentsGame();
    for (const d of districts.homeDistricts(cell(50, 50))) {
      expect(contents.contentsOf(d)).toMatchObject({
        cash: 0,
        survivors: 0,
        kind: DORMANT_NONE,
      });
    }
    const ring = contents.rings(districts.homeDistricts(cell(50, 50)));
    const out = outside(districts).map((d) => contents.contentsOf(d));
    expect(out.length).toBeGreaterThan(0);
    outside(districts).forEach((d) => {
      const c = contents.contentsOf(d);
      if (c.site < 0) return;
      // 5,000 gold and 20,000 survivors a ring, give or take a quarter.
      expect(c.cash).toBeGreaterThanOrEqual(3_700 * ring[d]);
      expect(c.cash).toBeLessThanOrEqual(6_300 * ring[d]);
      expect(c.survivors).toBeGreaterThanOrEqual(15_000 * ring[d]);
      expect(c.survivors).toBeLessThanOrEqual(25_000 * ring[d]);
    });
    const kinds = out.map((c) => c.kind).filter((k) => k !== DORMANT_NONE);
    expect(kinds.sort()).toEqual([DORMANT_CITY, DORMANT_FACTORY, DORMANT_SILO]);
  });

  test("they're placed the same way every game", async () => {
    const a = await contentsGame();
    const b = await contentsGame();
    expect(b.contents.state()).toEqual(a.contents.state());
  });

  test("with contents off, districts hold nothing", async () => {
    const { contents, horde } = await contentsGame({ districtContents: 0 });
    expect(contents.isPlaced()).toBe(false);
    expect(horde.encodeFrame()!.districtContents.length).toBe(0);
  });

  test("further out holds more, up to the last ring that counts", () => {
    // Six districts in a row: 0 is home, 5 is five rings out.
    const n = 6;
    const ids = new Uint16Array(n * 20);
    for (let c = 0; c < ids.length; c++) ids[c] = Math.floor(c / 20);
    const map: DistrictMap = {
      size: 1,
      handMade: true,
      count: n,
      ids,
      neighbours: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
    };
    const opts: DistrictContentOptions = {
      ...DEFAULT_HORDE_OPTIONS,
      districtContents: 1,
      cachePercent: 100,
      contentMaxRing: 3,
      contentMinCells: 1,
    };
    const contents = new DistrictContents(opts, map);
    expect(Array.from(contents.rings([0]))).toEqual([0, 1, 2, 3, 4, 5]);
    contents.place(
      new PseudoRandom(1),
      [0],
      (d) => Array.from({ length: 20 }, (_, k) => d * 20 + k),
      () => true,
      (c) => c,
      20 * n,
    );
    const survivors = [1, 2, 3, 4, 5].map(
      (d) => contents.contentsOf(d).survivors,
    );
    for (let r = 1; r <= 5; r++) {
      const ring = Math.min(r, 3);
      expect(survivors[r - 1]).toBeGreaterThanOrEqual(15_000 * ring);
      expect(survivors[r - 1]).toBeLessThanOrEqual(25_000 * ring);
    }
    expect(contents.contentsOf(0).survivors).toBe(0);
    // The Silo goes at least one ring beyond dormantMinRing (2).
    const silo = [0, 1, 2, 3, 4, 5].find(
      (d) => contents.contentsOf(d).kind === DORMANT_SILO,
    )!;
    expect(silo).toBeGreaterThanOrEqual(3);
  });
});

describe("Capturing a district", () => {
  test("collects its cash and survivors, once", async () => {
    const c = await contentsGame();
    const { survivor, districts, contents, game } = c;
    const d = outside(districts).find(
      (d) =>
        contents.contentsOf(d).kind === DORMANT_NONE &&
        contents.contentsOf(d).cash > 0,
    )!;
    const { cash, survivors } = contents.contentsOf(d);
    const gold = survivor.gold();
    const people = survivor.troops();
    const outpost = capture(c, d);
    expect(survivor.gold() - gold).toBe(BigInt(cash));
    expect(survivor.troops() - people).toBe(survivors);
    expect(contents.contentsOf(d)).toMatchObject({ cash: 0, survivors: 0 });
    // Lost and taken again: there's nothing left to collect.
    outpost.delete(false);
    run(game, 10);
    const again = survivor.gold();
    capture(c, d);
    expect(survivor.gold()).toBe(again);
  });

  test("wakes its dormant building, finished and free, and losing it puts it back to sleep", async () => {
    const c = await contentsGame();
    const { survivor, districts, contents, game } = c;
    const d = districtWith(districts, contents, DORMANT_FACTORY);
    const { site, cash } = contents.contentsOf(d);
    const gold = survivor.gold();
    const outpost = capture(c, d);
    const [factory] = unitsAt(survivor, UnitType.Factory, site);
    expect(factory).toBeDefined();
    expect(factory.isUnderConstruction()).toBe(false);
    expect(contents.contentsOf(d).awake).toBe(true);
    // Only the district's cash changed hands.
    expect(survivor.gold() - gold).toBe(BigInt(cash));
    // Lost: the Factory goes dormant again, rather than being destroyed.
    outpost.delete(false);
    run(game, 10);
    expect(unitsAt(survivor, UnitType.Factory, site)).toHaveLength(0);
    expect(contents.contentsOf(d)).toMatchObject({
      kind: DORMANT_FACTORY,
      awake: false,
    });
    // Taken back, it wakes again.
    capture(c, d);
    expect(unitsAt(survivor, UnitType.Factory, site)).toHaveLength(1);
  });

  test("a building wrecked while held stays dormant until the district is taken again", async () => {
    const c = await contentsGame();
    const { survivor, districts, contents, game } = c;
    const d = districtWith(districts, contents, DORMANT_CITY);
    const { site } = contents.contentsOf(d);
    const outpost = capture(c, d);
    unitsAt(survivor, UnitType.City, site)[0].delete(false);
    run(game, 30);
    expect(unitsAt(survivor, UnitType.City, site)).toHaveLength(0);
    expect(contents.contentsOf(d).awake).toBe(false);
    outpost.delete(false);
    run(game, 10);
    capture(c, d);
    expect(unitsAt(survivor, UnitType.City, site)).toHaveLength(1);
  });

  test("a Silo wakes as a mortar at its top level that fires harder still", async () => {
    const c = await contentsGame();
    const { survivor, districts, contents } = c;
    const d = districtWith(districts, contents, DORMANT_SILO);
    const { site } = contents.contentsOf(d);
    capture(c, d);
    const [silo] = unitsAt(survivor, UnitType.MissileSilo, site);
    expect(silo.level()).toBe(3);
    expect(contents.isWoken(silo.id(), DORMANT_SILO)).toBe(true);
    expect(contents.isWoken(silo.id(), DORMANT_CITY)).toBe(false);
  });

  test("the frame lists what's left, and flags districts next to held ground", async () => {
    const c = await contentsGame();
    const { horde, districts, contents } = c;
    const d = districtWith(districts, contents, DORMANT_FACTORY);
    const frame = () => horde.encodeFrame()!.districtContents;
    const rows = (f: Int32Array) =>
      Array.from({ length: f.length / 6 }, (_, k) =>
        f.subarray(k * 6, k * 6 + 6),
      );
    const site = contents.contentsOf(d).site;
    const before = rows(frame()).find((r) => r[0] === site)!;
    expect(before[3]).toBe(DORMANT_FACTORY);
    expect(before[4]).toBe(0);
    // Ring 1 is next to the start; further out isn't.
    const ring = contents.rings(districts.homeDistricts(cell(50, 50)));
    for (const r of rows(frame())) {
      const x = r[0] % 100;
      const at = districts.districtOf(cell(x, (r[0] - x) / 100));
      expect(r[5]).toBe(ring[at] === 1 ? 1 : 0);
    }
    capture(c, d);
    const after = rows(frame()).find((r) => r[0] === site)!;
    expect(after.slice(1, 6)).toEqual(Int32Array.from([0, 0, 2, 1, 0]));
  });
});

describe("Town economy", () => {
  test("people start at startingPopulation and don't grow on their own on town maps", async () => {
    const { survivor } = await contentsGame();
    expect(survivor.troops()).toBe(100_000);
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
    expect(config(GameMapType.Bath).townPopulation()).toBe(true);
    expect(config(GameMapType.Bath).troopIncreaseRate(survivor)).toBe(0);
    expect(config(GameMapType.Britannia).townPopulation()).toBe(false);
    expect(
      config(GameMapType.Britannia).troopIncreaseRate(survivor),
    ).toBeGreaterThan(0);
    expect(TOWN_HORDE_OPTIONS.districtContents).toBe(1);
  });

  test("tax, Factories and Cities", async () => {
    const c = await contentsGame();
    const { survivor, game, districts, contents } = c;
    capture(c, districtWith(districts, contents, DORMANT_FACTORY));
    capture(c, districtWith(districts, contents, DORMANT_CITY));
    const opts = {
      ...DEFAULT_HORDE_OPTIONS,
      hqIncome: 50,
      populationTax: 10,
      factoryIncome: 25,
      cityPopulation: 10,
    };
    const gold = survivor.gold();
    const people = survivor.troops();
    payHqIncome(game, opts);
    // 50 for the HQ, 25 for the Factory, 10 for each 100,000 people.
    expect(survivor.gold() - gold).toBe(
      BigInt(50 + 25 + Math.floor((people * 10) / 100_000)),
    );
    expect(survivor.troops() - people).toBe(10);
  });
});

describe("District contents snapshots", () => {
  test("a snapshot restores what's held, collected and awake", async () => {
    const c = await contentsGame();
    capture(c, districtWith(c.districts, c.contents, DORMANT_FACTORY));
    await expectSnapshotRoundTrip(c.game, "plains", 60);
  });

  test("a version 21 snapshot migrates with nothing in its districts", () => {
    const v21 = { initialized: true, options: { districtLand: 1 }, wave: 1 };
    const v22 = HordeExecutionSnapshot.migrations[21](v21);
    expect(v22.options).toMatchObject({
      districtLand: 1,
      districtContents: 0,
      populationTax: 0,
      startingPopulation: 0,
    });
    expect(v22.contents).toBeNull();
  });
});
