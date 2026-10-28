import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { Game } from "@openfront/engine/game/Game";
import { payBounty } from "@openfront/engine/horde/Economy";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { playerInfo, setup } from "../util/Setup";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells), so waves come ashore along the map edges.
const WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  waveInterval: 1_000,
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
};

// Only the source under test pays.
const NO_PAY: Partial<HordeOptions> = {
  hqIncome: 0,
  killBounty: 0,
  eliteBounty: 0,
  clearBonusPerWave: 0,
};

const QUIET: Partial<HordeOptions> = { firstWaveDelay: 10_000 };

/** A horde-mode survivor owning tiles 40..59 square, with plenty of gold. */
async function economyGame(
  options: Partial<HordeOptions>,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde: true }, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 52));
  survivor.addGold(10_000_000n);
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  return { game, horde };
}

/** Level 3 turrets on all four sides of the HQ. */
function ringOfTurrets(game: Game): void {
  const survivor = game.player("survivor");
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

/** Ticks until the horde counts wave 1 as survived, or -1. */
function ticksToClear(horde: HordeExecution, game: Game, limit: number) {
  for (let t = 1; t <= limit; t++) {
    game.executeNextTick();
    if (horde.stats().wavesSurvived >= 1) return t;
  }
  return -1;
}

describe("horde economy", () => {
  test("humans in horde mode get no flat gold per tick", async () => {
    const { game } = await economyGame(QUIET);
    const survivor = game.player("survivor");
    expect(game.config().goldAdditionRate(survivor)).toBe(0n);
    const plain = await setup("plains", {}, [
      playerInfo("p", PlayerType.Human),
    ]);
    expect(plain.config().goldAdditionRate(plain.player("p"))).toBeGreaterThan(
      0n,
    );
  });

  test("the HQ pays its trickle every tick", async () => {
    const { game } = await economyGame({ ...QUIET, hqIncome: 70 });
    const survivor = game.player("survivor");
    run(game, 5);
    const before = survivor.gold();
    run(game, 10);
    expect(survivor.gold() - before).toBe(700n);
  });

  test("turret kills pay their owner a bounty each", async () => {
    const { game, horde } = await economyGame({
      ...WAVES,
      ...NO_PAY,
      killBounty: 3,
    });
    ringOfTurrets(game);
    const survivor = game.player("survivor");
    const before = survivor.gold();
    run(game, 200);
    const killed = horde.stats().killed;
    expect(killed).toBeGreaterThan(0);
    expect(survivor.gold() - before).toBe(BigInt(3 * killed));
  });

  test("an elite pays the elite bounty", async () => {
    const { game } = await economyGame(QUIET);
    const survivor = game.player("survivor");
    const before = survivor.gold();
    payBounty(survivor, { ...DEFAULT_HORDE_OPTIONS, killBounty: 2 }, 5, 2);
    expect(survivor.gold() - before).toBe(
      BigInt(10 + 2 * DEFAULT_HORDE_OPTIONS.eliteBounty),
    );
  });

  test("clearing a wave pays the bonus once and says so", async () => {
    const { game, horde } = await economyGame({
      ...WAVES,
      ...NO_PAY,
      clearBonusPerWave: 1_234,
      clearedPercent: 2,
    });
    ringOfTurrets(game);
    const survivor = game.player("survivor");
    const before = survivor.gold();
    const messages: DisplayMessageUpdate[] = [];
    for (let t = 0; t < 900; t++) {
      const updates = game.executeNextTick();
      for (const u of updates[GameUpdateType.DisplayEvent]) {
        if (u.message === "events_display.wave_cleared") messages.push(u);
      }
    }
    expect(horde.stats().wave).toBe(1);
    expect(horde.stats().wavesSurvived).toBe(1);
    expect(survivor.gold() - before).toBe(1_234n);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      params: { wave: 1, gold: 1_234 },
      playerID: survivor.smallID(),
    });
  });

  test("a wave counts as cleared once few enough are left", async () => {
    // No turrets: nothing dies, so only the threshold decides.
    const all = await economyGame({ ...WAVES, clearedPercent: 100 });
    const none = await economyGame({ ...WAVES, clearedPercent: 0 });
    // Everything alive is at most 100% of the wave: cleared once it's out.
    expect(ticksToClear(all.horde, all.game, 200)).toBeGreaterThan(0);
    expect(ticksToClear(none.horde, none.game, 200)).toBe(-1);
  });

  test("the defaults pay from every source", () => {
    const o = DEFAULT_HORDE_OPTIONS;
    expect(o.hqIncome).toBeGreaterThan(0);
    expect(o.killBounty).toBeGreaterThan(0);
    expect(o.eliteBounty).toBeGreaterThan(o.killBounty);
    expect(o.clearBonusPerWave).toBeGreaterThan(0);
    expect(o.maxSpawnDistance).toBeGreaterThan(o.minSpawnDistance);
  });

  test("a version 6 snapshot migrates to OpenFront's income and no bounties", () => {
    const v6 = { initialized: true, options: { wallHp: 4_000 }, wave: 3 };
    const v7 = HordeExecutionSnapshot.migrations[6](v6);
    expect(v7.options).toMatchObject({
      wallHp: 4_000,
      hqIncome: 100,
      killBounty: 0,
      eliteBounty: 0,
      clearBonusPerWave: 0,
      clearedPercent: 0,
      maxSpawnDistance: 0,
    });
    expect(v7.wave).toBe(3);
  });
});
