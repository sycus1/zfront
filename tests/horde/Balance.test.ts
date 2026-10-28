import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// Waves on the 100x100 "plains" map come ashore along the edges, about 20
// coarse cells from a city in the middle.
const WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  waveInterval: 1_000,
  firstWaveSize: 4_000,
  emittersPerWave: 4,
  elitesPerWave: 0,
  structureHp: 600,
  pressureShift: 4,
};

async function cityGame(
  options: Partial<HordeOptions>,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", {}, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.buildUnit(UnitType.City, game.ref(50, 50), {});
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  return { game, horde };
}

/** Ticks until the city falls, or -1 if it stands for `limit` ticks. */
function ticksToFall(game: Game, limit: number): number {
  const survivor = game.player("survivor");
  for (let t = 1; t <= limit; t++) {
    game.executeNextTick();
    if (survivor.units(UnitType.City).length === 0) return t;
  }
  return -1;
}

describe("horde balance", () => {
  test("slower shamblers reach and break the city later", async () => {
    const fast = await cityGame({ ...WAVES, shamblerSpeed: 1 });
    const slow = await cityGame({ ...WAVES, shamblerSpeed: 3 });
    const fastFall = ticksToFall(fast.game, 600);
    const slowFall = ticksToFall(slow.game, 600);
    expect(fastFall).toBeGreaterThan(0);
    expect(slowFall).toBeGreaterThan(2 * fastFall);
  });

  test("a snapshot between shambler steps restores identically", async () => {
    const { game } = await cityGame({ ...WAVES, shamblerSpeed: 3 });
    // 41 is not a multiple of 3, so the restore lands between steps.
    for (let t = 0; t < 41; t++) game.executeNextTick();
    await expectSnapshotRoundTrip(game, "plains", 30);
  });

  test("the defaults give a minute to build and a growing horde", () => {
    const o = DEFAULT_HORDE_OPTIONS;
    expect(o.firstWaveDelay).toBe(600);
    let budget = o.firstWaveSize;
    for (let wave = 2; wave <= o.wavesToWin; wave++) {
      budget = Math.floor((budget * (100 + o.waveGrowthPercent)) / 100);
    }
    // Wave 10 is more than ten times wave 1.
    expect(budget).toBeGreaterThan(10 * o.firstWaveSize);
    expect(o.shamblerSpeed).toBeGreaterThan(1);
  });

  test("a version 3 snapshot migrates to a horde that steps every tick", () => {
    const v3 = { initialized: true, options: { eliteSpeed: 1 }, wave: 2 };
    const v4 = HordeExecutionSnapshot.migrations[3](v3);
    expect(v4.options).toMatchObject({ eliteSpeed: 1, shamblerSpeed: 1 });
    expect(v4.wave).toBe(2);
  });
});
