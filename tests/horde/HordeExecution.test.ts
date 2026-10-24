import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import {
  HordeExecution,
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

  test("a snapshot mid-wave restores and keeps ticking identically", async () => {
    const { game } = await hordeGame(SMALL_WAVES, [[50, 44]]);
    run(game, 40);
    await expectSnapshotRoundTrip(game, "plains", 30);
  });
});
