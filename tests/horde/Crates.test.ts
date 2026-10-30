import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { Game } from "@openfront/engine/game/Game";
import { Crate } from "@openfront/engine/horde/Crates";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells). The survivor owns 40..59 square, so crates land in the open
// around it. No wave comes unless a test asks for one.
const QUIET: Partial<HordeOptions> = {
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
  crateInterval: 20,
  crateMax: 3,
  crateMinDistance: 8,
  crateMaxDistance: 25,
  crateLife: 100,
  crateLootTicks: 10,
  crateDangerRadius: 2,
  crateBaseGold: 2_000,
  crateGoldPerWave: 1_500,
  crateLandingRadius: 15,
  crateLandingBonusPercent: 100,
  depotCratePercent: 25,
  depotCrateMax: 4,
};

async function crateGame(
  options: Partial<HordeOptions> = {},
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde: true }, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 50));
  const horde = new HordeExecution({ ...QUIET, ...options });
  game.addExecution(horde);
  return { game, horde };
}

function run(game: Game, ticks: number): DisplayMessageUpdate[] {
  const messages: DisplayMessageUpdate[] = [];
  for (let t = 0; t < ticks; t++) {
    const updates = game.executeNextTick();
    messages.push(
      ...(updates[GameUpdateType.DisplayEvent] as DisplayMessageUpdate[]),
    );
  }
  return messages;
}

function crates(horde: HordeExecution): readonly Crate[] {
  // Undefined until the horde starts, after the spawn phase.
  const c = (horde as unknown as { crates?: { all(): readonly Crate[] } })
    .crates;
  return c?.all() ?? [];
}

function field(horde: HordeExecution): HordeField {
  return (horde as unknown as { field: HordeField }).field;
}

/** Runs until the first crate drops; returns it. */
function firstCrate(game: Game, horde: HordeExecution): Crate {
  for (let t = 0; t < 200 && crates(horde).length === 0; t++) {
    game.executeNextTick();
  }
  expect(crates(horde).length).toBeGreaterThan(0);
  return crates(horde)[0];
}

describe("supply drops", () => {
  test("drop every interval outside the border, up to the limit", async () => {
    const { game, horde } = await crateGame();
    firstCrate(game, horde);
    run(game, 200);
    const survivor = game.player("survivor");
    const dropped = crates(horde);
    expect(dropped).toHaveLength(3);
    for (const c of dropped) {
      expect(game.owner(c.tile)).not.toBe(survivor);
      const x = game.x(c.tile);
      const y = game.y(c.tile);
      // 8 to 25 tiles past a border tile (40..59), away from the HQ.
      const out = Math.max(40 - x, x - 59, 40 - y, y - 59);
      expect(out).toBeGreaterThanOrEqual(5);
      expect(out).toBeLessThanOrEqual(26);
      expect(c.owner).toBe(survivor.smallID());
      expect(c.gold).toBe(3_500);
    }
    expect(new Set(dropped.map((c) => c.id)).size).toBe(3);
  });

  test("a crate pays its looter once looting is done", async () => {
    const { game, horde } = await crateGame();
    const survivor = game.player("survivor");
    const crate = firstCrate(game, horde);
    const before = survivor.gold();
    // Through the intent, as the client sends it.
    const executor = new Executor(game, "game", "c1");
    game.addExecution(
      executor.createExec({
        type: "loot_crate",
        crate: crate.id,
        clientID: survivor.clientID()!,
      }),
    );
    let messages = run(game, 5);
    expect(crate.lootEnd).toBeGreaterThan(0);
    expect(survivor.gold()).toBe(before);
    messages = run(game, 10);
    expect(survivor.gold() - before).toBe(3_500n);
    expect(crates(horde).some((c) => c.id === crate.id)).toBe(false);
    expect(
      messages.some((m) => m.message === "events_display.crate_looted"),
    ).toBe(true);
  });

  test("can't be looted twice, and unknown crates are ignored", async () => {
    const { game, horde } = await crateGame();
    const survivor = game.player("survivor");
    const crate = firstCrate(game, horde);
    expect(horde.lootCrate(survivor, crate.id)).toBe(true);
    expect(horde.lootCrate(survivor, crate.id)).toBe(false);
    expect(horde.lootCrate(survivor, 9_999)).toBe(false);
  });

  test("a crate nobody loots is gone at the end of its life", async () => {
    const { game, horde } = await crateGame({ crateMax: 1 });
    const crate = firstCrate(game, horde);
    run(game, 99);
    expect(crates(horde)[0]?.id).toBe(crate.id);
    run(game, 1);
    expect(crates(horde).some((c) => c.id === crate.id)).toBe(false);
  });

  test("zombies near a crate destroy it, even mid-loot", async () => {
    const { game, horde } = await crateGame({ crateMax: 1 });
    const survivor = game.player("survivor");
    const crate = firstCrate(game, horde);
    horde.lootCrate(survivor, crate.id);
    const before = survivor.gold();
    const w = game.miniMap().width();
    const cell = (game.y(crate.tile) >> 1) * w + (game.x(crate.tile) >> 1);
    field(horde).add(cell + 1, 5);
    const messages = run(game, 1);
    expect(crates(horde).some((c) => c.id === crate.id)).toBe(false);
    expect(
      messages.some((m) => m.message === "events_display.crate_lost"),
    ).toBe(true);
    run(game, 20);
    expect(survivor.gold()).toBe(before);
  });

  test("depots bring drops sooner, up to a limit", async () => {
    const drops = async (depots: number) => {
      const { game, horde } = await crateGame({
        crateMax: 100,
        crateLife: 10_000,
      });
      const survivor = game.player("survivor");
      survivor.addGold(10_000_000n);
      for (let k = 0; k < depots; k++) {
        survivor.buildUnit(UnitType.Depot, game.ref(42 + 3 * k, 42), {});
      }
      // Wait for the horde to start, then count drops over 400 ticks.
      firstCrate(game, horde);
      const before = crates(horde).length;
      run(game, 400);
      return crates(horde).length - before;
    };
    expect(await drops(0)).toBe(20);
    expect(await drops(4)).toBe(40);
    expect(await drops(6)).toBe(40);
  });

  test("crates near the announced landings are worth double", async () => {
    const { game, horde } = await crateGame({
      firstWaveDelay: 2_000,
      crateLandingRadius: 100,
      minSpawnDistance: 5,
      maxSpawnDistance: 0,
    });
    const crate = firstCrate(game, horde);
    expect(horde.upcomingLandings().length).toBeGreaterThan(0);
    expect(crate.gold).toBe(7_000);
  });

  test("the frame carries each crate", async () => {
    const { game, horde } = await crateGame();
    const crate = firstCrate(game, horde);
    horde.lootCrate(game.player("survivor"), crate.id);
    const frame = horde.encodeFrame()!;
    expect(Array.from(frame.crates.subarray(0, 5))).toEqual([
      crate.id,
      crate.tile,
      crate.gold,
      100,
      10,
    ]);
    expect(frame.crateLootTicks).toBe(10);
    expect(frame.crateLife).toBe(100);
  });

  test("survive a snapshot round trip mid-loot", async () => {
    const { game, horde } = await crateGame();
    const crate = firstCrate(game, horde);
    run(game, 30);
    horde.lootCrate(game.player("survivor"), crate.id);
    run(game, 3);
    await expectSnapshotRoundTrip(game, "plains", 60);
  });

  test("a version 10 snapshot migrates with drops off", () => {
    const v10 = { initialized: true, options: { hqIncome: 100 }, wave: 1 };
    const v11 = HordeExecutionSnapshot.migrations[10](v10);
    expect(v11.options).toMatchObject({ hqIncome: 100, crateInterval: 0 });
    expect(v11.crates).toBeNull();
  });
});
