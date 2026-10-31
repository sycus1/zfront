import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells), so waves come ashore along the map edges.
const WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  downtimeTicks: 200,
  waveCountdown: 50,
  maxWaveTicks: 0,
  firstWaveSize: 400,
  emittersPerWave: 4,
  elitesPerWave: 0,
  minSpawnDistance: 5,
  maxSpawnDistance: 0,
  shamblerSpeed: 1,
  eliteSpeed: 1,
  structureHp: 10_000_000,
  hqHp: 10_000_000,
  repairHp: 0,
  hqIncome: 0,
  killBounty: 0,
  eliteBounty: 0,
  clearBonusPerWave: 0,
  callEarlyGoldPerTick: 10,
  crateMax: 0,
};

async function waveGame(
  options: Partial<HordeOptions>,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde: true }, [
    new PlayerInfo("survivor", PlayerType.Human, "c1", "survivor"),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 52));
  const exec = new HordeExecution(options);
  game.addExecution(exec);
  return { game, horde: exec };
}

/** Level 3 turrets on all four sides of the HQ. */
function ringOfTurrets(game: Game): void {
  const survivor = game.player("survivor");
  survivor.addGold(10_000_000n);
  for (const [x, y] of [
    [50, 44],
    [50, 58],
    [44, 51],
    [56, 51],
  ]) {
    const t = survivor.buildUnit(UnitType.DefensePost, game.ref(x, y), {});
    survivor.upgradeUnit(t);
    survivor.upgradeUnit(t);
  }
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

/** Runs until wave `wave` is cleared; returns the ticks it took. */
function runUntilCleared(game: Game, horde: HordeExecution, wave: number) {
  let t = 0;
  for (; t < 2_000 && horde.stats().wavesSurvived < wave; t++) {
    game.executeNextTick();
  }
  expect(horde.stats().wavesSurvived).toBe(wave);
  return t;
}

describe("downtime between waves", () => {
  test("the next wave waits for the clear, then the downtime, then the countdown", async () => {
    const { game, horde } = await waveGame(WAVES);
    ringOfTurrets(game);
    run(game, 5);
    expect(horde.stats().wave).toBe(1);
    const fighting = horde.encodeFrame()!;
    expect(fighting.clearing).toBe(true);
    expect(fighting.nextWaveIn).toBe(-1);
    expect(fighting.clearLeft).toBeGreaterThan(0);
    // The next wave is already announced, so the HUD can show it.
    expect(fighting.nextWave).toBe(2);

    runUntilCleared(game, horde, 1);
    const cleared = horde.encodeFrame()!;
    expect(cleared.clearing).toBe(false);
    expect(cleared.clearLeft).toBe(0);
    expect(cleared.downtimeIn).toBe(200);
    expect(cleared.nextWaveIn).toBe(250);

    run(game, 199);
    expect(horde.encodeFrame()!.downtimeIn).toBe(1);
    run(game, 1);
    const countdown = horde.encodeFrame()!;
    expect(countdown.downtimeIn).toBe(0);
    expect(countdown.nextWaveIn).toBe(50);
    run(game, 49);
    expect(horde.stats().wave).toBe(1);
    run(game, 1);
    expect(horde.stats().wave).toBe(2);
    expect(horde.encodeFrame()!.clearing).toBe(true);
  });

  test("an uncleared wave holds up the next one", async () => {
    // No defences at all: the first wave never clears.
    const { game, horde } = await waveGame({ ...WAVES, startingTurrets: 0 });
    run(game, 1_500);
    expect(horde.stats().wave).toBe(1);
    expect(horde.stats().outcome).toBe("playing");
    const frame = horde.encodeFrame()!;
    expect(frame.clearing).toBe(true);
    expect(frame.canCallWave).toBe(false);
  });

  test("after maxWaveTicks an uncleared wave counts as outlasted and the downtime starts", async () => {
    const { game, horde } = await waveGame({
      ...WAVES,
      startingTurrets: 0,
      maxWaveTicks: 300,
    });
    for (let t = 0; t < 200 && horde.stats().wave < 1; t++) {
      game.executeNextTick();
    }
    expect(horde.stats().wave).toBe(1);
    run(game, 300);
    const frame = horde.encodeFrame()!;
    expect(frame.clearing).toBe(false);
    expect(frame.downtimeIn).toBeGreaterThan(195);
    // Not cleared, so it can't be called early, and it isn't survived yet.
    expect(frame.canCallWave).toBe(false);
    expect(horde.stats().wavesSurvived).toBe(0);
    run(game, 250);
    expect(horde.stats().wave).toBe(2);
    expect(horde.stats().wavesSurvived).toBe(1);
  });

  test("clearing the final wave wins straight away", async () => {
    const { game, horde } = await waveGame({ ...WAVES, wavesToWin: 1 });
    ringOfTurrets(game);
    run(game, 5);
    expect(horde.encodeFrame()!.nextWave).toBe(0);
    runUntilCleared(game, horde, 1);
    run(game, 1);
    expect(horde.stats().outcome).toBe("won");
    expect(game.getWinner()).not.toBeNull();
    // Played on past the win, the endless waves get the downtime too.
    const frame = horde.encodeFrame()!;
    expect(frame.clearing).toBe(false);
    expect(frame.downtimeIn).toBe(200);
    expect(frame.nextWaveIn).toBe(250);
    expect(frame.nextWave).toBe(2);
    run(game, 249);
    expect(horde.stats().wave).toBe(1);
    run(game, 1);
    expect(horde.stats().wave).toBe(2);
    expect(horde.encodeFrame()!.clearing).toBe(true);
  });

  test("calling the next wave in the downtime skips the downtime and the countdown", async () => {
    const { game, horde } = await waveGame(WAVES);
    ringOfTurrets(game);
    runUntilCleared(game, horde, 1);
    run(game, 20);
    expect(horde.callableTicks()).toBe(230);
    const survivor = game.player("survivor");
    const before = survivor.gold();
    expect(horde.callWave(survivor)).toBe(true);
    expect(survivor.gold() - before).toBe(2_300n);
    expect(horde.encodeFrame()!.downtimeIn).toBe(0);
    run(game, 1);
    expect(horde.stats().wave).toBe(2);
  });

  test("the first wave keeps its delay, with the countdown at the end", async () => {
    const { game, horde } = await waveGame({
      ...WAVES,
      firstWaveDelay: 300,
    });
    // The horde starts once the spawn phase is over.
    for (
      let t = 0;
      t < 200 && (horde.encodeFrame()?.nextWaveIn ?? -1) < 0;
      t++
    ) {
      game.executeNextTick();
    }
    const frame = horde.encodeFrame()!;
    expect(frame.nextWaveIn).toBeGreaterThan(250);
    expect(frame.nextWaveIn - frame.downtimeIn).toBe(50);
  });

  test("defaults: 90 seconds to build, then a 30-second countdown", () => {
    expect(DEFAULT_HORDE_OPTIONS.downtimeTicks).toBe(900);
    expect(DEFAULT_HORDE_OPTIONS.waveCountdown).toBe(300);
    expect(DEFAULT_HORDE_OPTIONS.maxWaveTicks).toBe(3_000);
  });

  test("a snapshot taken while clearing restores identically", async () => {
    const { game } = await waveGame(WAVES);
    ringOfTurrets(game);
    run(game, 5);
    await expectSnapshotRoundTrip(game, "plains", 60);
  });

  test("a snapshot taken in the downtime restores identically", async () => {
    const { game, horde } = await waveGame(WAVES);
    ringOfTurrets(game);
    runUntilCleared(game, horde, 1);
    run(game, 10);
    await expectSnapshotRoundTrip(game, "plains", 60);
  });

  test("a version 15 snapshot migrates, keeping its next wave's tick", () => {
    const v15 = {
      initialized: true,
      options: { waveInterval: 750, hqIncome: 50 },
      wave: 3,
      nextWaveTick: 2_000,
    };
    const v16 = HordeExecutionSnapshot.migrations[15](v15);
    expect(v16.options).toMatchObject({
      hqIncome: 50,
      downtimeTicks: 900,
      waveCountdown: 300,
      maxWaveTicks: 750,
    });
    expect("waveInterval" in v16.options).toBe(false);
    expect(v16.nextWaveTick).toBe(2_000);
    expect(v16.downtimeEndTick).toBe(-1);
    expect(v16.waveStartTick).toBe(1_250);
  });
});
