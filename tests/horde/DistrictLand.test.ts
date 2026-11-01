import {
  GameMapType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TOWN_OUTPOST_COST_STEP } from "@openfront/engine-lib/configuration/Config";
import { DistrictState } from "@openfront/engine-lib/game/Districts";
import { Game, Player } from "@openfront/engine/game/Game";
import { Districts } from "@openfront/engine/horde/Districts";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of open plains, 50x50 coarse
// cells, cut into 5x5 districts of about 10 cells. Districts are the land:
// the survivor starts with only the HQ tile at (50, 50), and the horde
// hands them the HQ's district and its neighbours. No wave comes.
const QUIET: Partial<HordeOptions> = {
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
  crateInterval: 0,
  settleTiles: 20,
  settleCost: 1,
  settlePercent: 0,
  outpostRadius: 6,
  buildingClaimRadius: 3,
  districtSize: 10,
  districtSecureTicks: 50,
  districtOverrunCount: 20,
  districtOverrunTicks: 30,
  districtCorePercent: 60,
  districtLand: 1,
};

async function landGame(
  options: Partial<HordeOptions> = {},
  gameMap: GameMapType = GameMapType.Britannia,
): Promise<{
  game: Game;
  survivor: Player;
  horde: HordeExecution;
  districts: Districts;
}> {
  const game = await setup("plains", { horde: true, gameMap }, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  survivor.conquer(game.ref(50, 50));
  survivor.setSpawnTile(game.ref(50, 50));
  survivor.addTroops(100_000);
  survivor.addGold(10_000_000n);
  const horde = new HordeExecution({ ...QUIET, ...options });
  game.addExecution(horde);
  run(game, 20);
  const districts = (horde as unknown as { districts: Districts }).districts;
  return { game, survivor, horde, districts };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

/** The coarse cell of tile (x, y). */
function cell(x: number, y: number): number {
  return (y >> 1) * 50 + (x >> 1);
}

/** A tile in the middle of district `d`'s cells. */
function tileIn(game: Game, districts: Districts, d: number) {
  const cells = districts.cellsOf(d);
  const c = cells[cells.length >> 1];
  return game.ref((c % 50) * 2, Math.floor(c / 50) * 2);
}

/** Tiles of district `d` that `p` owns, and how many it has. */
function ownedIn(game: Game, districts: Districts, d: number, p: Player) {
  let owned = 0;
  let all = 0;
  for (const c of districts.cellsOf(d)) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const t = game.ref((c % 50) * 2 + dx, Math.floor(c / 50) * 2 + dy);
        all++;
        if (game.owner(t) === p) owned++;
      }
    }
  }
  return { owned, all };
}

/** The home districts, and one Wild district next to them. */
function layout(districts: Districts) {
  const home = new Set(districts.homeDistricts(cell(50, 50)));
  const next = [...home]
    .flatMap((d) => districts.map.neighbours[d])
    .filter((d) => !home.has(d))
    .sort((a, b) => a - b);
  const far = [...Array(districts.map.count).keys()].filter(
    (d) =>
      !home.has(d) && !districts.map.neighbours[d].some((n) => home.has(n)),
  );
  return { home, next: next[0], far: far[0] };
}

describe("Districts as the land", () => {
  test("the game opens on the HQ's district and its neighbours, all Core", async () => {
    const { game, survivor, horde, districts } = await landGame();
    const { home, next } = layout(districts);
    expect(home.size).toBeGreaterThan(2);
    const states = horde.encodeFrame()!.districts;
    let total = 0;
    for (const d of home) {
      const { owned, all } = ownedIn(game, districts, d, survivor);
      expect(owned).toBe(all);
      expect(states[d]).toBe(DistrictState.Core);
      total += all;
    }
    expect(survivor.numTilesOwned()).toBe(total);
    expect(ownedIn(game, districts, next, survivor).owned).toBe(0);
  });

  test("nobody settles beyond the districts", async () => {
    const { game, survivor, horde } = await landGame();
    const before = survivor.numTilesOwned();
    run(game, 300);
    expect(survivor.numTilesOwned()).toBe(before);
    // So the placement preview draws no settling circle.
    expect(horde.encodeFrame()!.settleRadius).toBe(0);
  });

  test("an Outpost may only go in a Wild district next to yours", async () => {
    const { game, survivor, districts } = await landGame();
    const { home, next, far } = layout(districts);
    expect(
      survivor.canBuild(UnitType.Outpost, tileIn(game, districts, next)),
    ).not.toBe(false);
    expect(
      survivor.canBuild(UnitType.Outpost, tileIn(game, districts, far)),
    ).toBe(false);
    const own = [...home].find(
      (d) => d !== districts.districtOf(cell(50, 50)),
    )!;
    expect(
      survivor.canBuild(UnitType.Outpost, tileIn(game, districts, own)),
    ).toBe(false);
  });

  test("one Outpost a district, even while it's being built", async () => {
    const { game, survivor, districts } = await landGame(
      {},
      GameMapType.Britannia,
    );
    game.setOutpostLimit(5);
    const { next } = layout(districts);
    const cells = districts.cellsOf(next);
    const at = (c: number) => game.ref((c % 50) * 2, Math.floor(c / 50) * 2);
    survivor.buildUnit(UnitType.Outpost, at(cells[0]), {});
    expect(
      survivor.canBuild(UnitType.Outpost, at(cells[cells.length - 1])),
    ).toBe(false);
  });

  test("securing a district gives you all of it, losing the Outpost takes it back", async () => {
    const { game, survivor, horde, districts } = await landGame();
    const { next } = layout(districts);
    const outpost = survivor.buildUnit(
      UnitType.Outpost,
      tileIn(game, districts, next),
      {},
    );
    run(game, 20);
    // Securing: only the Outpost's own tile.
    expect(horde.encodeFrame()!.districts[next]).toBe(DistrictState.Securing);
    expect(ownedIn(game, districts, next, survivor).owned).toBe(1);
    run(game, 60);
    expect(horde.encodeFrame()!.districts[next]).toBe(DistrictState.Held);
    const held = ownedIn(game, districts, next, survivor);
    expect(held.owned).toBe(held.all);
    outpost.delete(false);
    run(game, 10);
    expect(horde.encodeFrame()!.districts[next]).toBe(DistrictState.Wild);
    expect(ownedIn(game, districts, next, survivor).owned).toBe(0);
  });

  test("an overrun district goes back to the wild with its land", async () => {
    const { game, survivor, horde, districts } = await landGame();
    const { next } = layout(districts);
    survivor.buildUnit(UnitType.Outpost, tileIn(game, districts, next), {});
    run(game, 80);
    expect(horde.encodeFrame()!.districts[next]).toBe(DistrictState.Held);
    const field = (horde as unknown as { field: HordeField }).field;
    field.add(districts.cellsOf(next)[0], 40);
    run(game, 50);
    expect(horde.encodeFrame()!.districts[next]).toBe(DistrictState.Wild);
    expect(ownedIn(game, districts, next, survivor).owned).toBe(0);
    expect(survivor.units(UnitType.Outpost).length).toBe(0);
  });

  test("the starting districts are never overrun", async () => {
    const { game, survivor, horde, districts } = await landGame();
    const { home } = layout(districts);
    const own = [...home].find(
      (d) => d !== districts.districtOf(cell(50, 50)),
    )!;
    const field = (horde as unknown as { field: HordeField }).field;
    field.add(districts.cellsOf(own)[0], 40);
    run(game, 50);
    expect(horde.encodeFrame()!.districts[own]).toBe(DistrictState.Core);
    const { owned, all } = ownedIn(game, districts, own, survivor);
    expect(owned).toBe(all);
  });

  test("on town maps each Outpost costs more than the last", async () => {
    const { game, survivor, districts } = await landGame({}, GameMapType.Bath);
    const cost = () => game.unitInfo(UnitType.Outpost).cost(game, survivor);
    expect(cost()).toBe(20_000n);
    const { next } = layout(districts);
    survivor.buildUnit(UnitType.Outpost, tileIn(game, districts, next), {});
    run(game, 80);
    expect(cost()).toBe(BigInt(20_000 + TOWN_OUTPOST_COST_STEP));
  });

  test("Outposts cost the same each on continent maps", async () => {
    const { game, survivor, districts } = await landGame();
    const { next } = layout(districts);
    survivor.buildUnit(UnitType.Outpost, tileIn(game, districts, next), {});
    run(game, 80);
    expect(game.unitInfo(UnitType.Outpost).cost(game, survivor)).toBe(20_000n);
  });

  test("a snapshot restores the land and the Outpost rule", async () => {
    const { game, survivor, districts } = await landGame();
    const { next, far } = layout(districts);
    survivor.buildUnit(UnitType.Outpost, tileIn(game, districts, next), {});
    run(game, 40);
    const restored = await expectSnapshotRoundTrip(game, "plains", 60);
    expect(restored.outpostSiteRule()).not.toBeNull();
    const me = restored.player("survivor");
    expect(
      me.canBuild(UnitType.Outpost, tileIn(restored, districts, far)),
    ).toBe(false);
  });

  test("with districtLand off, Outposts still claim round themselves", async () => {
    const { game, survivor, districts } = await landGame({ districtLand: 0 });
    expect(game.outpostSiteRule()).toBeNull();
    // Only the HQ tile: no start disc, as startingRadius is 0.
    const { next } = layout(districts);
    expect(ownedIn(game, districts, next, survivor).owned).toBe(0);
  });

  test("a version 19 snapshot migrates with districts not the land", () => {
    const v19 = { initialized: true, options: { districtSize: 25 }, wave: 1 };
    const v20 = HordeExecutionSnapshot.migrations[19](v19);
    expect(v20.options).toMatchObject({ districtSize: 25, districtLand: 0 });
  });
});
