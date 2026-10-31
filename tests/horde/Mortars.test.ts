import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import { Elites } from "@openfront/engine/horde/Elites";
import { UNREACHABLE } from "@openfront/engine/horde/FlowField";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import {
  MortarGun,
  MortarOptions,
  Mortars,
} from "@openfront/engine/horde/Mortars";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

const OPTS: MortarOptions = {
  mortarRange: 8,
  mortarMinRange: 3,
  mortarReload: 10,
  mortarFlight: 4,
  mortarBlastRadius: 1,
  mortarKills: 100,
  mortarEliteDamage: 150,
  mortarMinTarget: 20,
  mortarLevelPercent: 50,
};

const W = 30;
const at = (x: number, y: number) => y * W + x;
const GUN: MortarGun = { id: 1, cell: at(15, 15), owner: 7, level: 1 };

function world() {
  return {
    field: new HordeField(W, W, new Uint8Array(W * W).fill(1)),
    elites: new Elites(10, 1, 1),
    // No flow: the horde stays put, so shells land where they were aimed.
    still: new Uint32Array(W * W).fill(UNREACHABLE),
  };
}

describe("Mortars", () => {
  test("fires at the thickest part of the horde in range", () => {
    const { field, still } = world();
    const m = new Mortars(OPTS, W, W);
    field.add(at(20, 15), 30);
    // Two cells next to each other beat one bigger cell on its own.
    field.add(at(15, 21), 25);
    field.add(at(16, 21), 25);
    m.fire([GUN], 0, field, still, 0);
    expect(m.inFlight()).toEqual([
      { owner: 7, from: GUN.cell, target: at(15, 21), lands: 4, power: 100 },
    ]);
  });

  test("holds fire inside its dead zone, out of range or on a thin crowd", () => {
    const { field, still } = world();
    const m = new Mortars(OPTS, W, W);
    field.add(at(16, 15), 500); // too close
    field.add(at(15, 25), 500); // too far
    field.add(at(20, 15), 19); // too few
    m.fire([GUN], 0, field, still, 0);
    expect(m.inFlight()).toHaveLength(0);
    // It looks again next tick rather than waiting out a reload.
    field.add(at(20, 15), 1);
    m.fire([GUN], 1, field, still, 0);
    expect(m.inFlight()).toHaveLength(1);
  });

  test("reloads between shots", () => {
    const { field, still } = world();
    const m = new Mortars(OPTS, W, W);
    field.add(at(20, 15), 500);
    for (let t = 0; t < 25; t++) m.fire([GUN], t, field, still, 0);
    expect(m.inFlight().map((s) => s.lands)).toEqual([4, 14, 24]);
  });

  test("lands after its flight, killing nearest the impact first, and hurts elites", () => {
    const { field, elites, still } = world();
    const m = new Mortars(OPTS, W, W);
    field.add(at(20, 15), 80);
    field.add(at(21, 15), 80);
    field.add(at(23, 15), 80); // outside the blast
    elites.spawn(at(20, 16), 100);
    elites.spawn(at(20, 16), 400);
    m.fire([GUN], 0, field, still, 0);
    const target = m.inFlight()[0].target;
    expect(m.land(3, field, elites)).toEqual([]);
    expect(m.land(4, field, elites)).toEqual([
      { owner: 7, cell: target, shamblers: 100, elites: 1 },
    ]);
    expect(m.inFlight()).toHaveLength(0);
    expect(field.density[target]).toBe(0);
    expect(field.total()).toBe(140);
    expect(Array.from(elites.hp.subarray(0, 2))).toEqual([-50, 250]);
  });

  test("a higher level hits harder", () => {
    const { field, elites, still } = world();
    const m = new Mortars(OPTS, W, W);
    field.add(at(20, 15), 1_000);
    m.fire([{ ...GUN, level: 3 }], 0, field, still, 0);
    expect(m.land(4, field, elites)[0].shamblers).toBe(200);
  });

  test("leads the target along the flow field", () => {
    const { field } = world();
    const m = new Mortars(OPTS, W, W);
    // The horde walks west along row 15, one cell a step.
    const dist = new Uint32Array(W * W);
    for (let c = 0; c < W * W; c++) {
      dist[c] = (c % W) * 10 + Math.abs(Math.floor(c / W) - 15);
    }
    field.add(at(22, 15), 500);
    m.fire([GUN], 0, field, dist, 3);
    expect(m.inFlight()[0].target).toBe(at(19, 15));
  });

  test("forgets mortars that are gone; their shells still land", () => {
    const { field, elites, still } = world();
    const m = new Mortars(OPTS, W, W);
    field.add(at(20, 15), 500);
    m.fire([GUN], 0, field, still, 0);
    m.fire([], 1, field, still, 0);
    expect(m.state().readyIds).toEqual([]);
    expect(m.land(4, field, elites)).toHaveLength(1);
  });

  test("state round-trips", () => {
    const { field, still } = world();
    const m = new Mortars(OPTS, W, W);
    field.add(at(20, 15), 500);
    m.fire([GUN], 0, field, still, 0);
    const copy = new Mortars(OPTS, W, W);
    copy.restore(m.state());
    expect(copy.state()).toEqual(m.state());
  });
});

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
  pressureShift: 4,
  shamblerSpeed: 1,
  eliteSpeed: 1,
  structureHp: 10_000_000,
  hqHp: 10_000_000,
  startingTurrets: 0,
  killBounty: 1,
  hqIncome: 0,
  crateInterval: 0,
};

async function mortarGame(
  options: Partial<HordeOptions>,
  horde = true,
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", { horde, instantBuild: true }, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 52));
  survivor.addGold(10_000_000n);
  const exec = new HordeExecution(options);
  game.addExecution(exec);
  return { game, horde: exec };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

describe("the Missile Silo is a mortar in horde mode", () => {
  test("it costs 100k, has three levels and snaps to the build grid", async () => {
    const { game } = await mortarGame({ firstWaveDelay: 10_000 });
    const survivor = game.player("survivor");
    expect(game.unitInfo(UnitType.MissileSilo).cost(game, survivor)).toBe(
      100_000n,
    );
    expect(game.config().maxUnitLevel(UnitType.MissileSilo)).toBe(3);
    const tile = survivor.canBuild(UnitType.MissileSilo, game.ref(45, 45));
    expect(tile).not.toBe(false);
    expect(game.x(tile as number) % 2).toBe(0);
    expect(game.y(tile as number) % 2).toBe(0);
  });

  test("nukes and SAMs are off in horde mode, and only there", async () => {
    const { game } = await mortarGame({ firstWaveDelay: 10_000 });
    const plain = await setup("plains", {}, [
      playerInfo("p", PlayerType.Human),
    ]);
    for (const t of [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
      UnitType.SAMLauncher,
    ]) {
      expect(game.config().isUnitDisabled(t)).toBe(true);
      expect(plain.config().isUnitDisabled(t)).toBe(false);
    }
    expect(game.config().isUnitDisabled(UnitType.MissileSilo)).toBe(false);
  });

  test("it shells the horde on its own and earns the bounty", async () => {
    const { game, horde } = await mortarGame(WAVES);
    const survivor = game.player("survivor");
    survivor.buildUnit(UnitType.MissileSilo, game.ref(50, 46), {});
    const gold = survivor.gold();
    let blasts = 0;
    let shells = 0;
    for (let t = 0; t < 400; t++) {
      run(game, 1);
      const frame = horde.encodeFrame()!;
      blasts += frame.mortarBlasts.length;
      shells = Math.max(shells, frame.mortarShells.length / 4);
    }
    expect(blasts).toBeGreaterThan(0);
    expect(shells).toBeGreaterThan(0);
    expect(horde.stats().killed).toBeGreaterThan(0);
    expect(survivor.gold() - gold).toBe(BigInt(horde.stats().killed));
  });

  test("it doesn't fire while it is being built", async () => {
    const game = await setup("plains", { horde: true }, [
      playerInfo("survivor", PlayerType.Human),
    ]);
    const survivor = game.player("survivor");
    for (let y = 40; y < 60; y++) {
      for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
    }
    survivor.setSpawnTile(game.ref(50, 52));
    const horde = new HordeExecution(WAVES);
    game.addExecution(horde);
    const silo = survivor.buildUnit(UnitType.MissileSilo, game.ref(50, 46), {});
    silo.setUnderConstruction(true);
    run(game, 300);
    expect(horde.stats().killed).toBe(0);
  });

  test("a snapshot with shells in the air restores identically", async () => {
    const { game, horde } = await mortarGame(WAVES);
    game
      .player("survivor")
      .buildUnit(UnitType.MissileSilo, game.ref(50, 46), {});
    for (let t = 0; t < 400; t++) {
      run(game, 1);
      if (horde.encodeFrame()!.mortarShells.length > 0) break;
    }
    expect(horde.encodeFrame()!.mortarShells.length).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, "plains", 30);
  });

  test("a version 13 snapshot migrates with mortars that don't fire", () => {
    const v13 = { initialized: true, options: { wallHp: 4_000 } };
    const v14 = HordeExecutionSnapshot.migrations[13](v13);
    expect(v14.options).toMatchObject({ wallHp: 4_000, mortarRange: 0 });
    expect(v14.mortars).toBeNull();
  });

  test("defaults: a mortar out-ranges a turret and blasts more than one cell", () => {
    const d = DEFAULT_HORDE_OPTIONS;
    expect(d.mortarRange).toBeGreaterThan(d.turretRange);
    expect(d.mortarMinRange).toBeGreaterThan(0);
    expect(d.mortarBlastRadius).toBeGreaterThanOrEqual(1);
  });
});
