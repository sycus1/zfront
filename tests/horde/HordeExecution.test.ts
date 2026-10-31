import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  HORDE_EXACT_MAX,
  hordeDensityByte,
  hordeDensityCount,
} from "@openfront/engine-lib/game/HordeCells";
import { Game } from "@openfront/engine/game/Game";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells), so waves come ashore along the map edges.
const SMALL_WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  waveInterval: 200,
  firstWaveSize: 4_000,
  emittersPerWave: 4,
  emitRate: 200,
  elitesPerWave: 5,
  structureHp: 600,
  pressureShift: 4,
  shamblerSpeed: 1,
  eliteSpeed: 1,
};

async function hordeGame(
  options: Partial<HordeOptions>,
  defensePosts: [number, number][] = [],
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", {}, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.buildUnit(UnitType.City, game.ref(50, 50), {});
  for (const [x, y] of defensePosts) {
    survivor.buildUnit(UnitType.DefensePost, game.ref(x, y), {});
  }
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  return { game, horde };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

describe("HordeExecution", () => {
  test("an undefended city is overrun", async () => {
    const { game, horde } = await hordeGame(SMALL_WAVES);
    const survivor = game.player("survivor");
    expect(survivor.units(UnitType.City)).toHaveLength(1);
    run(game, 150);
    const s = horde.stats();
    expect(s.wave).toBe(1);
    expect(s.alive).toBeGreaterThan(0);
    expect(s.structuresDestroyed).toBe(1);
    expect(survivor.units(UnitType.City)).toHaveLength(0);
  });

  test("defense posts kill zombies and hold the line longer", async () => {
    const ring: [number, number][] = [
      [44, 44],
      [56, 44],
      [44, 56],
      [56, 56],
    ];
    const open = await hordeGame(SMALL_WAVES);
    const held = await hordeGame(SMALL_WAVES, ring);
    run(open.game, 60);
    run(held.game, 60);
    expect(open.horde.stats().killed).toBe(0);
    expect(held.horde.stats().killed).toBeGreaterThan(0);
    expect(held.horde.stats().alive).toBeLessThan(open.horde.stats().alive);
  });

  test("the same game twice gives the same horde", async () => {
    const a = await hordeGame(SMALL_WAVES, [[50, 44]]);
    const b = await hordeGame(SMALL_WAVES, [[50, 44]]);
    for (let t = 0; t < 250; t++) {
      a.game.executeNextTick();
      b.game.executeNextTick();
      if (t % 25 === 0) {
        expect(a.horde.stateHash()).toBe(b.horde.stateHash());
      }
    }
    expect(a.horde.stateHash()).toBe(b.horde.stateHash());
    expect(a.horde.stats().wave).toBe(2);
  });

  test("the HQ falls under pressure and the player loses", async () => {
    const { game, horde } = await hordeGame({ ...SMALL_WAVES, hqHp: 2_000 });
    const survivor = game.player("survivor");
    survivor.setSpawnTile(game.ref(50, 48));
    expect(survivor.isAlive()).toBe(true);
    let t = 0;
    for (; t < 400 && survivor.isAlive(); t++) game.executeNextTick();
    expect(horde.stats().hqsFallen).toBe(1);
    expect(horde.stats().hqHp).toBe(0);
    expect(survivor.isAlive()).toBe(false);
    expect(survivor.numTilesOwned()).toBe(0);
  });

  test("a snapshot mid-wave restores and keeps ticking identically", async () => {
    const { game } = await hordeGame(SMALL_WAVES, [[50, 44]]);
    game.player("survivor").setSpawnTile(game.ref(50, 52));
    run(game, 40);
    await expectSnapshotRoundTrip(game, "plains", 30);
  });

  test("surviving every wave wins, and waves go on for keep playing", async () => {
    const { game, horde } = await hordeGame({
      ...SMALL_WAVES,
      wavesToWin: 2,
      hqHp: 10_000_000,
    });
    const survivor = game.player("survivor");
    survivor.setSpawnTile(game.ref(50, 48));
    run(game, 380);
    expect(horde.stats().wave).toBe(2);
    expect(horde.stats().outcome).toBe("playing");
    expect(game.getWinner()).toBeNull();
    run(game, 40);
    expect(horde.stats().outcome).toBe("won");
    expect(game.getWinner()).toBe(survivor);
    // The next wave is announced with a countdown, then arrives: the game
    // keeps running past the win instead of freezing.
    const frame = horde.encodeFrame()!;
    expect(frame.nextWave).toBe(3);
    expect(frame.nextWaveFinal).toBe(false);
    expect(frame.nextWaveIn).toBeGreaterThan(0);
    const hash = horde.stateHash();
    run(game, 250);
    expect(horde.stats().wave).toBe(3);
    expect(horde.stateHash()).not.toBe(hash);
    // Still won, and the result is only reported once.
    expect(horde.stats().outcome).toBe("won");
    expect(game.getWinner()).toBe(survivor);
  });

  test("a won game played on keeps its win when the HQ later falls", async () => {
    const { game, horde } = await hordeGame({
      ...SMALL_WAVES,
      wavesToWin: 1,
      hqHp: 100_000,
    });
    const survivor = game.player("survivor");
    survivor.setSpawnTile(game.ref(50, 48));
    run(game, 205);
    expect(horde.stats().outcome).toBe("won");
    for (let t = 0; t < 2_000 && survivor.isAlive(); t++) {
      game.executeNextTick();
    }
    expect(survivor.isAlive()).toBe(false);
    expect(horde.stats().outcome).toBe("won");
    expect(game.getWinner()).toBe(survivor);
  });

  test("a lost game stops the horde", async () => {
    const { game, horde } = await hordeGame({ ...SMALL_WAVES, hqHp: 2_000 });
    game.player("survivor").setSpawnTile(game.ref(50, 48));
    run(game, 400);
    expect(horde.stats().outcome).toBe("lost");
    const hash = horde.stateHash();
    run(game, 250);
    expect(horde.stateHash()).toBe(hash);
  });

  test("losing the last HQ marks the game lost", async () => {
    const { game, horde } = await hordeGame({ ...SMALL_WAVES, hqHp: 2_000 });
    game.player("survivor").setSpawnTile(game.ref(50, 48));
    run(game, 400);
    expect(horde.stats().outcome).toBe("lost");
    expect(horde.encodeFrame()?.outcome).toBe("lost");
    expect(game.getWinner()).toBeNull();
  });

  test("the frame carries wave progress and kills for the HUD", async () => {
    const { game, horde } = await hordeGame({ ...SMALL_WAVES, wavesToWin: 7 }, [
      [50, 44],
    ]);
    run(game, 60);
    const frame = horde.encodeFrame()!;
    expect(frame.wave).toBe(1);
    expect(frame.wavesToWin).toBe(7);
    expect(frame.killed).toBe(horde.stats().killed);
    expect(frame.killed).toBeGreaterThan(0);
    expect(frame.outcome).toBe("playing");
  });

  test("the frame carries exact counts for thin cells", async () => {
    const { game, horde } = await hordeGame(SMALL_WAVES, [[50, 44]]);
    run(game, 60);
    const frame = horde.encodeFrame()!;
    const density = horde.density();
    let thin = 0;
    for (let c = 0; c < density.length; c++) {
      const b = frame.cells[c];
      if (b >= 248) continue;
      expect(b).toBe(hordeDensityByte(density[c]));
      if (density[c] > 0 && density[c] <= HORDE_EXACT_MAX) {
        expect(hordeDensityCount(b)).toBe(density[c]);
        thin++;
      }
    }
    expect(thin).toBeGreaterThan(0);
  });

  describe("flow-field debounce", () => {
    // No waves, so nothing destroys what the test builds.
    const QUIET: Partial<HordeOptions> = {
      firstWaveDelay: 10_000,
      flowDebounce: 10,
      flowMaxDelay: 50,
    };

    function build(game: Game, x: number, y: number): void {
      game.player("survivor").buildUnit(UnitType.City, game.ref(x, y), {});
    }

    test("a burst of structures costs one recompute once it settles", async () => {
      const { game, horde } = await hordeGame(QUIET);
      run(game, 3);
      expect(horde.stats().recomputes).toBe(1);
      for (let k = 0; k < 5; k++) {
        build(game, 42 + 3 * k, 42);
        run(game, 1);
      }
      // Still inside the debounce window of the last placement.
      run(game, 5);
      expect(horde.stats().recomputes).toBe(1);
      run(game, 10);
      expect(horde.stats().recomputes).toBe(2);
      run(game, 30);
      expect(horde.stats().recomputes).toBe(2);
    });

    test("structures that keep changing still recompute after the max delay", async () => {
      const { game, horde } = await hordeGame(QUIET);
      run(game, 3);
      for (let k = 0; k < 60; k++) {
        build(game, 41 + (k % 18), 41 + Math.floor(k / 18) * 3);
        run(game, 1);
        if (k === 48) expect(horde.stats().recomputes).toBe(1);
      }
      expect(horde.stats().recomputes).toBe(2);
    });

    test("new structures block the horde before the flow field catches up", async () => {
      const { game, horde } = await hordeGame(QUIET);
      run(game, 3);
      build(game, 44, 44);
      run(game, 1);
      expect(horde.stats().recomputes).toBe(1);
      // The obstacle map already holds the new city.
      const field = (horde as unknown as { field: { obstacle: Uint8Array } })
        .field;
      const mini = game.miniMap();
      expect(field.obstacle[22 * mini.width() + 22]).toBe(1);
    });

    test("a snapshot with a recompute pending restores identically", async () => {
      // Nothing falls in the window, so the only recompute is the pending one.
      const { game, horde } = await hordeGame(
        { ...SMALL_WAVES, structureHp: 1_000_000, hqHp: 10_000_000 },
        [[50, 44]],
      );
      game.player("survivor").setSpawnTile(game.ref(50, 52));
      run(game, 40);
      build(game, 46, 50);
      run(game, 2);
      const before = horde.stats().recomputes;
      await expectSnapshotRoundTrip(game, "plains", 30);
      expect(horde.stats().recomputes).toBe(before + 1);
    });

    test("a version 1 snapshot migrates to endless waves and an immediate rebuild", () => {
      const v1 = {
        initialized: true,
        options: { hqHp: 1 },
        wave: 3,
      };
      const v2 = HordeExecutionSnapshot.migrations[1](v1);
      expect(v2.options).toMatchObject({
        hqHp: 1,
        wavesToWin: 0,
        flowDebounce: 0,
        flowMaxDelay: 0,
      });
      expect(v2).toMatchObject({
        wave: 3,
        outcome: 0,
        structureSig: -1,
        flowCells: null,
        firstPendingTick: -1,
      });
    });
  });
});
