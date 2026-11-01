import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import {
  beaconSounding,
  BuildingOptions,
  detonate,
} from "@openfront/engine/horde/Buildings";
import { Elites } from "@openfront/engine/horde/Elites";
import { ORTHO_STEP } from "@openfront/engine/horde/FlowField";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells), so waves come ashore along the map edges.
const WAVES: Partial<HordeOptions> = {
  // No head start: these tests count gold and land from zero.
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 1,
  maxWaveTicks: 1_000,
  firstWaveSize: 4_000,
  emittersPerWave: 4,
  elitesPerWave: 0,
  minSpawnDistance: 5,
  maxSpawnDistance: 0,
  shamblerSpeed: 1,
  eliteSpeed: 1,
  structureHp: 10_000_000,
  turretHp: 10_000_000,
  hqHp: 10_000_000,
  repairHp: 0,
  hqIncome: 0,
  clearBonusPerWave: 0,
  flowDebounce: 0,
};

const QUIET: Partial<HordeOptions> = {
  // No head start: these tests count gold and land from zero.
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
};

const OPTS: BuildingOptions = {
  mineRadius: 2,
  mineTrigger: 40,
  mineKills: 100,
  mineEliteDamage: 300,
  baitPull: 30,
  baitActive: 300,
  baitCooldown: 600,
};

/** A horde-mode survivor owning tiles 30..69 square, with plenty of gold. */
async function baseGame(
  options: Partial<HordeOptions>,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde: true }, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 30; y < 70; y++) {
    for (let x = 30; x < 70; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 50));
  survivor.addGold(10_000_000n);
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  return { game, horde };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

function internals(horde: HordeExecution) {
  return horde as unknown as {
    hordeFlow: { dist: Uint32Array };
    hordeTargetCells: number[];
  };
}

function cell(game: Game, x: number, y: number): number {
  return (y >> 1) * game.miniMap().width() + (x >> 1);
}

describe("mines", () => {
  function field(): { field: HordeField; elites: Elites } {
    const w = 20;
    return {
      field: new HordeField(w, w, new Uint8Array(w * w).fill(1)),
      elites: new Elites(10, 1, 1),
    };
  }
  // A radius 2 disc on a 20-wide grid, nearest first.
  const disc = (() => {
    const pts: [number, number, number][] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy <= 4) pts.push([dx * dx + dy * dy, dy, dx]);
      }
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    return Int32Array.from(pts.flatMap(([, dy, dx]) => [dx, dy * 20 + dx]));
  })();
  const centre = 10 * 20 + 10;

  test("waits until enough of the horde is around it", () => {
    const { field: f, elites } = field();
    f.add(centre + 1, 39);
    expect(detonate(OPTS, f, elites, centre, disc)).toBeNull();
    expect(f.total()).toBe(39);
  });

  test("then kills up to its limit, nearest first, and hurts elites", () => {
    const { field: f, elites } = field();
    f.add(centre, 60);
    f.add(centre + 2, 60);
    f.add(centre + 5, 60); // outside the radius
    elites.spawn(centre + 1, 250);
    elites.spawn(centre + 1, 400);
    const hit = detonate(OPTS, f, elites, centre, disc);
    expect(hit).toEqual({ shamblers: 100, elites: 1 });
    expect(f.density[centre]).toBe(0);
    expect(f.density[centre + 2]).toBe(20);
    expect(f.density[centre + 5]).toBe(60);
    expect(Array.from(elites.hp.subarray(0, 2))).toEqual([-50, 100]);
  });

  test("a mine in the horde's path goes off once and pays its owner", async () => {
    const { game, horde } = await baseGame({
      ...WAVES,
      killBounty: 3,
      eliteBounty: 0,
    });
    const survivor = game.player("survivor");
    const mine = survivor.buildUnit(UnitType.Mine, game.ref(36, 50), {});
    const before = survivor.gold();
    let ticks = 0;
    while (mine.isActive() && ticks < 400) {
      game.executeNextTick();
      ticks++;
    }
    expect(mine.isActive()).toBe(false);
    const killed = horde.stats().killed;
    expect(killed).toBeGreaterThanOrEqual(DEFAULT_HORDE_OPTIONS.mineTrigger);
    expect(survivor.gold() - before).toBe(BigInt(3 * killed));
  });

  test("the frame shows a mine, and mines aren't targets", async () => {
    const { game, horde } = await baseGame(QUIET);
    game.player("survivor").buildUnit(UnitType.Mine, game.ref(36, 50), {});
    run(game, 3);
    const frame = horde.encodeFrame()!;
    expect(frame.cells[cell(game, 36, 50)]).toBe(248);
    expect(internals(horde).hordeTargetCells).not.toContain(cell(game, 36, 50));
  });
});

describe("noise beacons", () => {
  test("sound, then rest, from when they are built", () => {
    expect(beaconSounding(OPTS, 100, 100)).toBe(true);
    expect(beaconSounding(OPTS, 100, 399)).toBe(true);
    expect(beaconSounding(OPTS, 100, 400)).toBe(false);
    expect(beaconSounding(OPTS, 100, 999)).toBe(false);
    expect(beaconSounding(OPTS, 100, 1000)).toBe(true);
    expect(beaconSounding({ ...OPTS, baitActive: 0 }, 0, 0)).toBe(false);
  });

  test("a sounding beacon draws the horde ahead of the HQ, a resting one doesn't", async () => {
    const { game, horde } = await baseGame({
      ...QUIET,
      baitActive: 50,
      baitCooldown: 100,
    });
    const beacon = cell(game, 34, 50);
    const hq = cell(game, 50, 50);
    game
      .player("survivor")
      .buildUnit(UnitType.NoiseBeacon, game.ref(34, 50), {});
    run(game, 3);
    const dist = internals(horde).hordeFlow.dist;
    expect(dist[beacon]).toBe(0);
    // The beacon is 8 cells away, nearer than the HQ's 30-cell handicap, so
    // even zombies at the HQ head on to the beacon, and from beyond the HQ
    // the flow runs through it.
    expect(dist[hq]).toBeGreaterThan(0);
    expect(dist[hq]).toBeLessThan(30 * ORTHO_STEP);
    expect(dist[cell(game, 66, 50)]).toBeGreaterThan(dist[hq]);
    expect(horde.encodeFrame()!.cells[beacon]).toBe(250);
    run(game, 60);
    expect(dist[beacon]).not.toBe(0);
    expect(dist[hq]).toBe(0);
    expect(horde.encodeFrame()!.cells[beacon]).toBe(249);
    run(game, 100);
    expect(dist[beacon]).toBe(0);
  });

  test("a snapshot with a beacon resting restores identically", async () => {
    const { game } = await baseGame({
      ...WAVES,
      baitActive: 20,
      baitCooldown: 30,
    });
    game
      .player("survivor")
      .buildUnit(UnitType.NoiseBeacon, game.ref(34, 50), {});
    game.player("survivor").buildUnit(UnitType.Mine, game.ref(64, 50), {});
    run(game, 25);
    await expectSnapshotRoundTrip(game, "plains", 60);
  });
});

describe("scavenger depots", () => {
  test("pay their owner every tick once built", async () => {
    const { game, horde } = await baseGame({ ...QUIET, depotIncome: 7 });
    const survivor = game.player("survivor");
    const depot = survivor.buildUnit(UnitType.Depot, game.ref(40, 40), {});
    survivor.buildUnit(UnitType.Depot, game.ref(44, 40), {});
    run(game, 2);
    let before = survivor.gold();
    run(game, 10);
    expect(survivor.gold() - before).toBe(140n);
    depot.setUnderConstruction(true);
    before = survivor.gold();
    run(game, 10);
    expect(survivor.gold() - before).toBe(70n);
    expect(internals(horde).hordeTargetCells).toContain(cell(game, 40, 40));
    expect(horde.encodeFrame()!.cells[cell(game, 44, 40)]).toBe(251);
  });
});

describe("building rules", () => {
  test("mines, beacons and depots only exist in horde mode", async () => {
    const plain = await setup("plains", {}, [
      playerInfo("p", PlayerType.Human),
    ]);
    const { game } = await baseGame(QUIET);
    for (const type of [UnitType.Mine, UnitType.NoiseBeacon, UnitType.Depot]) {
      expect(plain.config().isUnitDisabled(type)).toBe(true);
      expect(game.config().isUnitDisabled(type)).toBe(false);
    }
  });

  test("they go where they are placed, not next to each other", async () => {
    const { game } = await baseGame(QUIET);
    const survivor = game.player("survivor");
    const at = game.ref(40, 40);
    expect(survivor.canBuild(UnitType.Depot, at)).toBe(at);
    survivor.buildUnit(UnitType.Depot, at, {});
    expect(survivor.canBuild(UnitType.Mine, game.ref(41, 41))).toBe(false);
    expect(survivor.canBuild(UnitType.Mine, game.ref(42, 40))).toBe(
      game.ref(42, 40),
    );
  });

  test("a version 8 snapshot migrates with no buildings", () => {
    const v8 = { initialized: true, options: { hqIncome: 100 }, wave: 1 };
    const v9 = HordeExecutionSnapshot.migrations[8](v8);
    expect(v9.options).toMatchObject({ hqIncome: 100, depotIncome: 0 });
    expect(v9.beaconIds).toEqual([]);
    expect(v9.flowBait).toEqual([]);
  });
});
