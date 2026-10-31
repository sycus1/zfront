import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { Game } from "@openfront/engine/game/Game";
import { CallWaveExecution } from "@openfront/engine/horde/CallWaveExecution";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { NUM_SECTORS, sectorOf } from "@openfront/engine/horde/WaveDirector";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells), so waves come ashore along the map edges.
const WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 300,
  maxWaveTicks: 1_000,
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
};

async function waveGame(
  options: Partial<HordeOptions>,
  horde = true,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde }, [
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

function run(game: Game, ticks: number): DisplayMessageUpdate[] {
  const messages: DisplayMessageUpdate[] = [];
  for (let t = 0; t < ticks; t++) {
    const updates = game.executeNextTick();
    messages.push(...updates[GameUpdateType.DisplayEvent]);
  }
  return messages;
}

/** Sends a call_wave intent from the survivor, as a turn would. */
function callWave(game: Game): void {
  const executor = new Executor(game, "game", "c1");
  game.addExecution(executor.createExec({ type: "call_wave", clientID: "c1" }));
}

describe("calling a wave early", () => {
  test("before the first wave, it starts now and pays for the break skipped", async () => {
    const { game, horde } = await waveGame(WAVES);
    const survivor = game.player("survivor");
    run(game, 100);
    expect(horde.stats().wave).toBe(0);
    const left = horde.callableTicks();
    expect(left).toBeGreaterThan(150);
    const before = survivor.gold();
    callWave(game);
    const messages = run(game, 2);
    expect(horde.stats().wave).toBe(1);
    // The call lands a tick after the left was read.
    const paid = survivor.gold() - before;
    expect(paid).toBeGreaterThanOrEqual(BigInt((left - 1) * 10));
    expect(paid).toBeLessThanOrEqual(BigInt(left * 10));
    const called = messages.filter(
      (m) => m.message === "events_display.wave_called",
    );
    expect(called).toHaveLength(1);
    expect(called[0].params).toMatchObject({ wave: 1 });
  });

  test("can't be called while the wave under way is still alive", async () => {
    const { game, horde } = await waveGame({ ...WAVES, firstWaveDelay: 1 });
    run(game, 20);
    expect(horde.stats().wave).toBe(1);
    expect(horde.stats().alive).toBeGreaterThan(0);
    expect(horde.callableTicks()).toBe(0);
    expect(horde.encodeFrame()!.canCallWave).toBe(false);
    const gold = game.player("survivor").gold();
    callWave(game);
    run(game, 2);
    expect(horde.stats().wave).toBe(1);
    expect(game.player("survivor").gold()).toBe(gold);
  });

  test("once a wave is cleared the next can be called, without counting it twice", async () => {
    const { game, horde } = await waveGame({ ...WAVES, firstWaveDelay: 1 });
    ringOfTurrets(game);
    for (let t = 0; t < 900 && horde.stats().wavesSurvived < 1; t++) {
      game.executeNextTick();
    }
    expect(horde.stats().wavesSurvived).toBe(1);
    const frame = horde.encodeFrame()!;
    expect(frame.canCallWave).toBe(true);
    expect(frame.callWaveGold).toBe(horde.callableTicks() * 10);
    callWave(game);
    run(game, 2);
    expect(horde.stats().wave).toBe(2);
    expect(horde.stats().wavesSurvived).toBe(1);
  });

  test("only humans still standing can call it", async () => {
    const { game, horde } = await waveGame(WAVES);
    run(game, 10);
    const bot = game.addPlayer(
      new PlayerInfo("bot", PlayerType.Bot, null, "bot"),
    );
    expect(horde.callWave(bot)).toBe(false);
    expect(horde.callWave(game.player("survivor"))).toBe(true);
    // Called already: the second call in the same tick does nothing.
    expect(horde.callWave(game.player("survivor"))).toBe(false);
  });

  test("outside horde mode the intent does nothing", async () => {
    const game = await setup("plains", {}, [
      new PlayerInfo("p", PlayerType.Human, "c1", "p"),
    ]);
    game.addExecution(new CallWaveExecution(game.player("p")));
    expect(() => run(game, 2)).not.toThrow();
  });
});

describe("wave landings", () => {
  test("are picked when the wave is announced, in its directions", async () => {
    const { game, horde } = await waveGame(WAVES);
    run(game, 10);
    const plan = horde.upcomingWave()!;
    const landings = [...horde.upcomingLandings()];
    expect(landings).toHaveLength(4);
    const w = game.miniMap().width();
    const frame = horde.encodeFrame()!;
    const hx = frame.hqCell % w;
    const hy = Math.floor(frame.hqCell / w);
    expect(frame.hqCell).toBeGreaterThanOrEqual(0);
    expect([...frame.nextWaveLandings]).toEqual(landings);
    for (const c of landings) {
      const s = sectorOf((c % w) - hx, Math.floor(c / w) - hy);
      expect(s).toBeLessThan(NUM_SECTORS);
      expect(plan.sectors & (1 << s)).not.toBe(0);
    }
  });

  test("the wave comes ashore where it was announced", async () => {
    const { game, horde } = await waveGame({ ...WAVES, emitRate: 1 });
    run(game, 10);
    const landings = [...horde.upcomingLandings()];
    callWave(game);
    run(game, 2);
    expect(horde.stats().wave).toBe(1);
    const emitters = (horde as unknown as { emitterCells: number[] })
      .emitterCells;
    expect(emitters).toEqual(landings);
    // The next wave is announced with landings of its own.
    expect(horde.upcomingWave()!.wave).toBe(2);
    expect(horde.upcomingLandings().length).toBe(4);
  });

  test("a snapshot with a wave announced restores identically", async () => {
    const { game } = await waveGame(WAVES);
    run(game, 10);
    await expectSnapshotRoundTrip(game, "plains", 400);
  });

  test("a version 7 snapshot migrates with no early call and landings picked at the start", () => {
    const v7 = { initialized: true, options: { hqIncome: 100 }, wave: 2 };
    const v8 = HordeExecutionSnapshot.migrations[7](v7);
    expect(v8.options).toMatchObject({
      hqIncome: 100,
      callEarlyGoldPerTick: 0,
    });
    expect(v8.nextLandings).toEqual([]);
    expect(v8.wave).toBe(2);
  });
});
