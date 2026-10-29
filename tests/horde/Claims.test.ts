import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "@openfront/engine/game/Game";
import {
  applyClaims,
  lapseOutpost,
  OUTPOST_REACH,
  outpostLimit,
} from "@openfront/engine/horde/Claims";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of passable plains. The survivor
// holds a 20x20 square in the middle with the HQ at its centre.
async function survivorGame(): Promise<{ game: Game; survivor: Player }> {
  const game = await setup("plains", { horde: true, infiniteGold: true }, [
    new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 50));
  return { game, survivor };
}

const OPTS: HordeOptions = {
  ...DEFAULT_HORDE_OPTIONS,
  outpostRadius: 6,
  buildingClaimRadius: 2,
  // No waves and no passive settling, so only claims change the land.
  firstWaveDelay: 100_000,
  settleTiles: 0,
  startingTurrets: 0,
};

function owned(game: Game, p: Player, x: number, y: number): boolean {
  return game.owner(game.ref(x, y)) === p;
}

describe("Claims", () => {
  test("an Outpost may go on free land within reach of the border", async () => {
    const { game, survivor } = await survivorGame();
    const edge = 59;
    expect(
      survivor.canBuild(UnitType.Outpost, game.ref(edge + OUTPOST_REACH, 50)),
    ).not.toBe(false);
    expect(
      survivor.canBuild(
        UnitType.Outpost,
        game.ref(edge + OUTPOST_REACH + 2, 50),
      ),
    ).toBe(false);
    // Other buildings still need the player's own land.
    expect(survivor.canBuild(UnitType.Depot, game.ref(edge + 3, 50))).toBe(
      false,
    );
  });

  test("the number of Outposts is limited", async () => {
    const { game, survivor } = await survivorGame();
    game.setOutpostLimit(1);
    survivor.buildUnit(UnitType.Outpost, game.ref(65, 50), {});
    expect(survivor.canBuild(UnitType.Outpost, game.ref(35, 50))).toBe(false);
    game.setOutpostLimit(2);
    expect(survivor.canBuild(UnitType.Outpost, game.ref(35, 50))).not.toBe(
      false,
    );
    expect(outpostLimit(OPTS, 0)).toBe(1);
    expect(outpostLimit(OPTS, 3)).toBe(2);
    expect(outpostLimit(OPTS, 4)).toBe(3);
  });

  test("Outposts are only built in horde mode", async () => {
    const plain = await setup("plains", {}, [
      new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
    ]);
    expect(plain.config().isUnitDisabled(UnitType.Outpost)).toBe(true);
    const { game } = await survivorGame();
    expect(game.config().isUnitDisabled(UnitType.Outpost)).toBe(false);
  });

  test("an Outpost holds its tile while built and its radius once done", async () => {
    const { game, survivor } = await survivorGame();
    const outpost = survivor.buildUnit(UnitType.Outpost, game.ref(66, 50), {});
    outpost.setUnderConstruction(true);
    expect(applyClaims(game, survivor, OPTS)).toBe(1);
    expect(owned(game, survivor, 66, 50)).toBe(true);
    expect(owned(game, survivor, 67, 50)).toBe(false);
    outpost.setUnderConstruction(false);
    applyClaims(game, survivor, OPTS);
    expect(owned(game, survivor, 72, 50)).toBe(true);
    expect(owned(game, survivor, 73, 50)).toBe(false);
    expect(owned(game, survivor, 66, 44)).toBe(true);
  });

  test("other buildings round off the land, walls don't", async () => {
    const { game, survivor } = await survivorGame();
    survivor.buildUnit(UnitType.Depot, game.ref(59, 45), {});
    survivor.buildUnit(UnitType.Wall, game.ref(59, 55), {});
    applyClaims(game, survivor, OPTS);
    expect(owned(game, survivor, 61, 45)).toBe(true);
    expect(owned(game, survivor, 62, 45)).toBe(false);
    expect(owned(game, survivor, 60, 55)).toBe(false);
  });

  test("a lost Outpost's land lapses unless something else claims it", async () => {
    const { game, survivor } = await survivorGame();
    const outpost = survivor.buildUnit(UnitType.Outpost, game.ref(66, 50), {});
    // A depot on the Outpost's land keeps its own small claim.
    applyClaims(game, survivor, OPTS);
    survivor.buildUnit(UnitType.Depot, game.ref(70, 50), {});
    applyClaims(game, survivor, OPTS);
    outpost.delete(false);
    const released = lapseOutpost(
      game,
      survivor,
      OPTS,
      game.ref(66, 50),
      survivor.spawnTile(),
      12,
    );
    expect(released).toBeGreaterThan(0);
    expect(owned(game, survivor, 66, 50)).toBe(false);
    expect(owned(game, survivor, 66, 45)).toBe(false);
    // Kept: the depot's claim, and the passive disc round the HQ.
    expect(owned(game, survivor, 70, 50)).toBe(true);
    expect(owned(game, survivor, 71, 50)).toBe(true);
    expect(owned(game, survivor, 61, 50)).toBe(true);
  });

  describe("in a horde game", () => {
    async function hordeGame() {
      const { game, survivor } = await survivorGame();
      const horde = new HordeExecution(OPTS);
      game.addExecution(horde);
      return { game, survivor, horde };
    }

    function run(game: Game, ticks: number) {
      for (let t = 0; t < ticks; t++) game.executeNextTick();
    }

    test("a built Outpost claims land and losing it gives it back", async () => {
      const { game, survivor } = await hordeGame();
      const outpost = survivor.buildUnit(
        UnitType.Outpost,
        game.ref(66, 50),
        {},
      );
      run(game, 20);
      expect(owned(game, survivor, 72, 50)).toBe(true);
      outpost.delete(false);
      run(game, 20);
      expect(owned(game, survivor, 72, 50)).toBe(false);
      expect(owned(game, survivor, 55, 50)).toBe(true);
    });

    test("the Outpost limit follows the waves survived", async () => {
      const { game } = await hordeGame();
      run(game, 2);
      expect(game.outpostLimit()).toBe(1);
    });

    test("a snapshot with an Outpost restores identically", async () => {
      const { game, survivor } = await hordeGame();
      survivor.buildUnit(UnitType.Outpost, game.ref(66, 50), {});
      run(game, 15);
      await expectSnapshotRoundTrip(game, "plains", 30);
    });
  });

  test("a version 10 snapshot migrates to radius settling", () => {
    const v10 = {
      options: { settleTiles: 20, zoneBaseTiles: 1_500, zoneTilesPerWave: 1 },
      wave: 2,
    };
    const v11 = HordeExecutionSnapshot.migrations[10](v10);
    expect(v11.options).not.toHaveProperty("zoneBaseTiles");
    expect(v11.options).toMatchObject({
      settleTiles: 20,
      settleRadius: 14,
      outpostRadius: 12,
    });
    expect(v11.outpostTiles).toEqual([]);
  });
});
