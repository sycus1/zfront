import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NoOpExecution } from "@openfront/engine/execution/NoOpExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import {
  passiveRadius,
  settle,
  SettleView,
} from "@openfront/engine/horde/Settlement";
import { setup } from "../util/Setup";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells). The survivor starts with a 20x20 square in the middle.
async function survivorGame(
  horde = false,
): Promise<{ game: Game; survivor: Player }> {
  const game = await setup("plains", { horde }, [
    new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 50));
  return { game, survivor };
}

function emptyView(game: Game): SettleView {
  const mini = game.miniMap();
  const n = mini.width() * mini.height();
  return {
    cellOf: (t) => (game.y(t) >> 1) * mini.width() + (game.x(t) >> 1),
    density: new Uint16Array(n),
    covered: new Uint8Array(n),
  };
}

const OPTS: HordeOptions = {
  ...DEFAULT_HORDE_OPTIONS,
  settleTiles: 20,
  settleCost: 100,
  settleRadius: 16,
  settleRadiusPerWave: 4,
  refugeesPerWave: 1_000,
};

function fill(game: Game, p: Player): void {
  p.addTroops(game.config().maxTroops(p) - p.troops());
}

describe("Settlement", () => {
  test("settlers claim free land and pay for it in population", async () => {
    const { game, survivor } = await survivorGame();
    fill(game, survivor);
    const before = survivor.troops();
    const claimed = settle(game, survivor, OPTS, 0, emptyView(game));
    expect(claimed).toBe(20);
    expect(survivor.numTilesOwned()).toBe(420);
    expect(survivor.troops()).toBe(before - 20 * OPTS.settleCost);
  });

  test("nobody leaves while population is below the threshold", async () => {
    const { game, survivor } = await survivorGame();
    survivor.removeTroops(survivor.troops());
    expect(settle(game, survivor, OPTS, 0, emptyView(game))).toBe(0);
    expect(survivor.numTilesOwned()).toBe(400);
  });

  test("settlers fill a disc round the HQ that grows each wave", async () => {
    const { game, survivor } = await survivorGame();
    const opts = { ...OPTS, settleRadius: 12, settleTiles: 200 };
    expect(passiveRadius(opts, 0)).toBe(12);
    expect(passiveRadius(opts, 1)).toBe(16);
    const settleUntilFull = (waves: number) => {
      for (let k = 0; k < 20; k++) {
        fill(game, survivor);
        settle(game, survivor, opts, waves, emptyView(game));
      }
    };
    const furthest = () =>
      Math.max(
        ...[...survivor.tiles()]
          .filter((t) => {
            const x = game.x(t);
            const y = game.y(t);
            return x < 40 || x >= 60 || y < 40 || y >= 60;
          })
          .map((t) => (game.x(t) - 50) ** 2 + (game.y(t) - 50) ** 2),
      );
    settleUntilFull(0);
    const atZero = survivor.numTilesOwned();
    expect(atZero).toBeGreaterThan(400);
    expect(furthest()).toBeLessThanOrEqual(12 * 12);
    settleUntilFull(1);
    expect(survivor.numTilesOwned()).toBeGreaterThan(atZero);
    expect(furthest()).toBeLessThanOrEqual(16 * 16);
    expect(furthest()).toBeGreaterThan(12 * 12);
  });

  test("settlers avoid the horde and prefer turret cover", async () => {
    const { game, survivor } = await survivorGame();
    const view = emptyView(game);
    const w = game.miniMap().width();
    // Horde along the whole west edge; turrets cover the east edge.
    for (let cy = 0; cy < 50; cy++) {
      view.density[cy * w + 19] = 50;
      view.covered[cy * w + 30] = 1;
    }
    fill(game, survivor);
    settle(game, survivor, OPTS, 0, view);
    expect(survivor.numTilesOwned()).toBe(420);
    for (let y = 0; y < 100; y++) {
      expect(game.owner(game.ref(39, y))).not.toBe(survivor);
    }
    let east = 0;
    for (let y = 0; y < 100; y++) {
      if (game.owner(game.ref(60, y)) === survivor) east++;
    }
    expect(east).toBe(20);
  });

  test("surviving a wave brings refugees", async () => {
    const { game, survivor } = await survivorGame();
    const horde = new HordeExecution({
      ...OPTS,
      firstWaveDelay: 1,
      waveInterval: 50,
      firstWaveSize: 100,
      emittersPerWave: 1,
      elitesPerWave: 0,
      wavesToWin: 0,
      hqHp: 10_000_000,
      structureHp: 10_000_000,
    });
    game.addExecution(horde);
    survivor.removeTroops(survivor.troops());
    for (let t = 0; t < 60; t++) game.executeNextTick();
    expect(horde.stats().wave).toBe(2);
    expect(horde.stats().wavesSurvived).toBeGreaterThanOrEqual(1);
    expect(survivor.troops()).toBeGreaterThanOrEqual(OPTS.refugeesPerWave);
  });

  test("the same game twice settles the same land", async () => {
    const a = await survivorGame();
    const b = await survivorGame();
    for (const { game, survivor } of [a, b]) {
      game.addExecution(new HordeExecution({ ...OPTS, firstWaveDelay: 20 }));
      fill(game, survivor);
    }
    for (let t = 0; t < 100; t++) {
      a.game.executeNextTick();
      b.game.executeNextTick();
    }
    const tilesA = [...a.survivor.tiles()].sort((x, y) => x - y);
    const tilesB = [...b.survivor.tiles()].sort((x, y) => x - y);
    expect(tilesA.length).toBeGreaterThan(400);
    expect(tilesA).toEqual(tilesB);
  });

  test("a version 4 snapshot migrates with settling off", () => {
    const v4 = { initialized: true, options: { shamblerSpeed: 3 }, wave: 3 };
    const v5 = HordeExecutionSnapshot.migrations[4](v4);
    expect(v5.options).toMatchObject({
      shamblerSpeed: 3,
      settleTiles: 0,
      refugeesPerWave: 0,
    });
    expect(v5.wavesSurvived).toBe(2);
  });

  describe("in horde mode humans can't expand by hand", () => {
    test("no attacks on free land", async () => {
      const { game, survivor } = await survivorGame(true);
      expect(survivor.canAttack(game.ref(70, 50))).toBe(false);
      const plain = await survivorGame(false);
      expect(plain.survivor.canAttack(plain.game.ref(70, 50))).toBe(true);
    });

    test("attack and boat intents are dropped", async () => {
      const { game } = await survivorGame(true);
      const executor = new Executor(game, "game_id", "c1");
      const attack = executor.createExec({
        type: "attack",
        clientID: "c1",
        targetID: game.terraNullius().id(),
        troops: 1_000,
      });
      expect(attack).toBeInstanceOf(NoOpExecution);
      const boat = executor.createExec({
        type: "boat",
        clientID: "c1",
        troops: 1_000,
        dst: game.ref(70, 50),
      });
      expect(boat).toBeInstanceOf(NoOpExecution);
    });
  });
});
