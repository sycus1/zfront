import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { TOWN_HORDE_OPTIONS } from "@openfront/engine/horde/TownScale";
import { playerInfo, setup } from "../util/Setup";

// The "plains" test map is 100x100 tiles of open land.
const QUIET: Partial<HordeOptions> = {
  firstWaveDelay: 10_000,
  hqIncome: 0,
  crateMax: 0,
  settleCost: 0,
};

async function startGame(
  options: Partial<HordeOptions>,
  bots = false,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde: true }, [
    playerInfo("survivor", PlayerType.Human),
    ...(bots ? [playerInfo("bot", PlayerType.Bot)] : []),
  ]);
  const survivor = game.player("survivor");
  survivor.conquer(game.ref(50, 50));
  survivor.setSpawnTile(game.ref(50, 50));
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  return { game, horde };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

describe("the start of a horde game", () => {
  test("each survivor gets the land within startingRadius and the starting gold", async () => {
    const { game } = await startGame({
      ...QUIET,
      startingRadius: 10,
      startingGold: 30_000,
    });
    const survivor = game.player("survivor");
    const gold = survivor.gold();
    run(game, 1);
    // Wait out the spawn phase: the horde starts after it.
    for (let t = 0; t < 200 && survivor.numTilesOwned() < 100; t++) {
      run(game, 1);
    }
    // A disc of radius 10 is about 317 tiles.
    expect(survivor.numTilesOwned()).toBeGreaterThanOrEqual(300);
    expect(survivor.numTilesOwned()).toBeLessThan(340);
    expect(game.owner(game.ref(58, 50))).toBe(survivor);
    expect(game.owner(game.ref(62, 50))).not.toBe(survivor);
    expect(survivor.gold() - gold).toBeGreaterThanOrEqual(30_000n);
    // Nothing is built for them: the first turret is theirs to place.
    expect(survivor.units(UnitType.DefensePost)).toHaveLength(0);
  });

  test("land already owned by someone else stays theirs", async () => {
    const { game } = await startGame({ ...QUIET, startingRadius: 10 }, true);
    const bot = game.player("bot");
    bot.conquer(game.ref(55, 50));
    for (
      let t = 0;
      t < 200 && game.player("survivor").numTilesOwned() < 100;
      t++
    ) {
      run(game, 1);
    }
    expect(game.owner(game.ref(55, 50))).toBe(bot);
  });

  test("the first turret a survivor places is free, the next one isn't", async () => {
    const { game } = await startGame({ ...QUIET, startingGold: 0 });
    const survivor = game.player("survivor");
    // Wait for the starting land to build on.
    for (let t = 0; t < 200 && survivor.numTilesOwned() < 100; t++) {
      run(game, 1);
    }
    const info = game.unitInfo(UnitType.DefensePost);
    expect(info.cost(game, survivor)).toBe(0n);
    // With no gold at all, the free one can still be built.
    survivor.removeGold(survivor.gold());
    expect(survivor.canBuild(UnitType.DefensePost, game.ref(54, 50))).not.toBe(
      false,
    );
    survivor.buildUnit(UnitType.DefensePost, game.ref(54, 50), {});
    expect(info.cost(game, survivor)).toBe(50_000n);
    expect(survivor.canBuild(UnitType.DefensePost, game.ref(46, 50))).toBe(
      false,
    );
  });

  test("defaults: a bigger start, starting gold and no free turret built", () => {
    expect(DEFAULT_HORDE_OPTIONS.startingTurrets).toBe(0);
    expect(DEFAULT_HORDE_OPTIONS.startingGold).toBe(30_000);
    expect(DEFAULT_HORDE_OPTIONS.startingRadius).toBe(24);
    expect(TOWN_HORDE_OPTIONS.startingRadius).toBe(60);
    // Settlers carry on from the edge of the starting land.
    expect(TOWN_HORDE_OPTIONS.settleRadius).toBe(60);
  });

  test("a version 16 snapshot migrates with no head start", () => {
    const v16 = { initialized: true, options: { hqIncome: 50 }, wave: 3 };
    const v17 = HordeExecutionSnapshot.migrations[16](v16);
    expect(v17.options).toMatchObject({
      hqIncome: 50,
      startingGold: 0,
      startingRadius: 0,
    });
  });
});
