import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game, Unit } from "@openfront/engine/game/Game";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
  turretRange,
} from "@openfront/engine/horde/HordeExecution";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of passable plains (50x50 coarse
// cells), so waves come ashore along the map edges.
const WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  waveInterval: 1_000,
  firstWaveSize: 4_000,
  emittersPerWave: 4,
  elitesPerWave: 0,
  pressureShift: 4,
  shamblerSpeed: 1,
  eliteSpeed: 1,
};

const QUIET: Partial<HordeOptions> = { firstWaveDelay: 10_000 };

/** A horde-mode survivor owning tiles 40..59 square, with plenty of gold. */
async function defenceGame(
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

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

/** Private horde state the tests poke at. */
function internals(horde: HordeExecution) {
  return horde as unknown as {
    damage: Map<number, number>;
    lastHit: Map<number, number>;
  };
}

describe("wall tiers", () => {
  test("a wall upgrades through three tiers and no further", async () => {
    const { game } = await defenceGame(QUIET);
    const survivor = game.player("survivor");
    const wall = survivor.buildUnit(UnitType.Wall, game.ref(44, 44), {});
    expect(wall.level()).toBe(1);
    for (const level of [2, 3]) {
      expect(survivor.canUpgradeUnit(wall)).toBe(true);
      survivor.upgradeUnit(wall);
      expect(wall.level()).toBe(level);
    }
    expect(survivor.canUpgradeUnit(wall)).toBe(false);
  });

  test("each tier costs the same and walls are cheaper than before", async () => {
    const { game } = await defenceGame(QUIET);
    const survivor = game.player("survivor");
    const cost = game.unitInfo(UnitType.Wall).cost(game, survivor);
    expect(cost).toBe(5_000n);
    const wall = survivor.buildUnit(UnitType.Wall, game.ref(44, 44), {});
    const before = survivor.gold();
    survivor.upgradeUnit(wall);
    expect(survivor.gold()).toBe(before - cost);
  });

  test("only the wall under the cursor is upgraded; elsewhere builds anew", async () => {
    const { game } = await defenceGame(QUIET);
    const survivor = game.player("survivor");
    const wall = survivor.buildUnit(UnitType.Wall, game.ref(44, 44), {});
    expect(survivor.findUnitToUpgrade(UnitType.Wall, game.ref(44, 44))).toBe(
      wall,
    );
    expect(survivor.findUnitToUpgrade(UnitType.Wall, game.ref(45, 45))).toBe(
      wall,
    );
    // Two tiles along, where the next wall in a line goes.
    expect(survivor.findUnitToUpgrade(UnitType.Wall, game.ref(46, 44))).toBe(
      false,
    );
    const [next] = survivor.buildableUnits(game.ref(46, 44), [UnitType.Wall]);
    expect(next.canUpgrade).toBe(false);
    expect(next.canBuild).not.toBe(false);
  });

  test("a higher tier takes more pressure before it falls", async () => {
    const hold = async (tier: number): Promise<number> => {
      const { game, horde } = await defenceGame({
        ...WAVES,
        wallHp: 300,
        stoneWallHp: 3_000,
        reinforcedWallHp: 30_000,
        repairHp: 0,
      });
      const survivor = game.player("survivor");
      // Seal the HQ in, so the horde has to break a wall.
      for (let k = 44; k <= 58; k += 2) {
        for (const [x, y] of [
          [k, 44],
          [k, 58],
          [44, k],
          [58, k],
        ]) {
          const t = game.ref(x, y);
          if (survivor.canBuild(UnitType.Wall, t) === false) continue;
          const w = survivor.buildUnit(UnitType.Wall, t, {});
          for (let l = 1; l < tier; l++) survivor.upgradeUnit(w);
        }
      }
      for (let t = 1; t <= 600; t++) {
        game.executeNextTick();
        if (horde.stats().structuresDestroyed > 0) return t;
      }
      return 601;
    };
    const barricade = await hold(1);
    const stone = await hold(2);
    const reinforced = await hold(3);
    expect(barricade).toBeLessThan(stone);
    expect(stone).toBeLessThan(reinforced);
  });

  test("the frame shows each tier as its own wall byte", async () => {
    const { game, horde } = await defenceGame(QUIET);
    const survivor = game.player("survivor");
    const walls = [44, 48, 52].map((x) =>
      survivor.buildUnit(UnitType.Wall, game.ref(x, 44), {}),
    );
    survivor.upgradeUnit(walls[1]);
    survivor.upgradeUnit(walls[2]);
    survivor.upgradeUnit(walls[2]);
    run(game, 3);
    const frame = horde.encodeFrame()!;
    const byte = (x: number) => frame.cells[22 * frame.width + (x >> 1)];
    expect([byte(44), byte(48), byte(52)]).toEqual([252, 253, 254]);
  });
});

describe("turrets", () => {
  test("in horde mode turrets cost the same each time and have 3 levels", async () => {
    const { game } = await defenceGame(QUIET);
    const survivor = game.player("survivor");
    const info = game.unitInfo(UnitType.DefensePost);
    const first = info.cost(game, survivor);
    const turret = survivor.buildUnit(
      UnitType.DefensePost,
      game.ref(50, 44),
      {},
    );
    expect(info.cost(game, survivor)).toBe(first);
    survivor.upgradeUnit(turret);
    survivor.upgradeUnit(turret);
    expect(turret.level()).toBe(3);
    expect(survivor.canUpgradeUnit(turret)).toBe(false);
  });

  test("outside horde mode the Defense Post keeps OpenFront's rules", async () => {
    const game = await setup("plains", {}, [playerInfo("p", PlayerType.Human)]);
    const p = game.player("p");
    expect(game.config().unitInfo(UnitType.DefensePost).upgradable).toBe(false);
    expect(game.unitInfo(UnitType.DefensePost).cost(game, p)).toBe(50_000n);
  });

  test("a higher level kills more zombies", async () => {
    const kills = async (level: number): Promise<number> => {
      const { game, horde } = await defenceGame({
        ...WAVES,
        structureHp: 10_000_000,
        hqHp: 10_000_000,
        startingTurrets: 0,
      });
      const survivor = game.player("survivor");
      const t = survivor.buildUnit(UnitType.DefensePost, game.ref(50, 44), {});
      for (let l = 1; l < level; l++) survivor.upgradeUnit(t);
      run(game, 150);
      return horde.stats().killed;
    };
    const one = await kills(1);
    const three = await kills(3);
    expect(one).toBeGreaterThan(0);
    // Level 3 has twice the base firepower.
    expect(2 * three).toBeGreaterThan(3 * one);
  });

  test("high ground adds range, up to three bonuses", () => {
    const o = { turretRange: 8, turretHighGroundBonus: 2 };
    expect(turretRange(o, 0)).toBe(8);
    expect(turretRange(o, 9)).toBe(9);
    expect(turretRange(o, 10)).toBe(10);
    expect(turretRange(o, 20)).toBe(12);
    expect(turretRange(o, 31)).toBe(14);
    expect(turretRange({ ...o, turretHighGroundBonus: 0 }, 31)).toBe(8);
  });
});

describe("starting turret", () => {
  test("each survivor starts with a finished turret by the HQ, for free", async () => {
    const free = await defenceGame(QUIET);
    const none = await defenceGame({ ...QUIET, startingTurrets: 0 });
    run(free.game, 2);
    run(none.game, 2);
    const survivor = free.game.player("survivor");
    const turrets = survivor.units(UnitType.DefensePost);
    expect(turrets).toHaveLength(1);
    expect(turrets[0].isUnderConstruction()).toBe(false);
    // Off the HQ's 2x2 coarse cell, but close by.
    const map = free.game.map();
    const hq = survivor.spawnTile()!;
    const t = turrets[0].tile();
    expect(
      map.x(t) >> 1 !== map.x(hq) >> 1 || map.y(t) >> 1 !== map.y(hq) >> 1,
    ).toBe(true);
    expect(map.manhattanDist(t, hq)).toBeLessThanOrEqual(6);
    expect(survivor.gold()).toBe(none.game.player("survivor").gold());
    expect(none.game.player("survivor").units(UnitType.DefensePost)).toEqual(
      [],
    );
    // Only at the start.
    run(free.game, 20);
    expect(survivor.units(UnitType.DefensePost)).toHaveLength(1);
  });

  test("the starting turret fights the first wave", async () => {
    const { game, horde } = await defenceGame({
      ...WAVES,
      structureHp: 10_000_000,
      hqHp: 10_000_000,
    });
    run(game, 150);
    expect(horde.stats().killed).toBeGreaterThan(0);
  });

  test("the frame carries each firing turret's shot", async () => {
    const { game, horde } = await defenceGame({
      ...WAVES,
      structureHp: 10_000_000,
      hqHp: 10_000_000,
    });
    let shots: Int32Array = new Int32Array();
    for (let k = 0; k < 300 && shots.length === 0; k++) {
      run(game, 1);
      shots = horde.encodeFrame()!.turretShots;
    }
    expect(shots).toHaveLength(2);
    const turret = game.player("survivor").units(UnitType.DefensePost)[0];
    const map = game.map();
    const w = game.miniMap().width();
    const t = turret.tile();
    expect(shots[0]).toBe((map.y(t) >> 1) * w + (map.x(t) >> 1));
    expect(shots[1]).not.toBe(shots[0]);
  });

  test("a version 9 snapshot migrates without a starting turret", () => {
    const v9 = { initialized: true, options: { wallHp: 4_000 } };
    const v10 = HordeExecutionSnapshot.migrations[9](v9);
    expect(v10.options).toMatchObject({ wallHp: 4_000, startingTurrets: 0 });
  });
});

describe("repair", () => {
  async function damagedWall(
    options: Partial<HordeOptions>,
  ): Promise<{ game: Game; horde: HordeExecution; wall: Unit }> {
    const { game, horde } = await defenceGame({ ...QUIET, ...options });
    const wall = game
      .player("survivor")
      .buildUnit(UnitType.Wall, game.ref(44, 44), {});
    run(game, 1);
    internals(horde).damage.set(wall.id(), 1_000);
    internals(horde).lastHit.set(wall.id(), game.ticks());
    return { game, horde, wall };
  }

  test("a structure left alone repairs for gold", async () => {
    const opts = {
      repairDelay: 20,
      repairInterval: 10,
      repairHp: 100,
      repairGoldPerHp: 2,
    };
    const { game, horde, wall } = await damagedWall(opts);
    // The same game with nothing to repair, for the income alone.
    const control = await damagedWall(opts);
    internals(control.horde).damage.clear();
    run(game, 15);
    run(control.game, 15);
    // Still inside the delay: nothing repaired yet.
    expect(internals(horde).damage.get(wall.id())).toBe(1_000);
    run(game, 200);
    run(control.game, 200);
    expect(internals(horde).damage.has(wall.id())).toBe(false);
    const spent =
      control.game.player("survivor").gold() - game.player("survivor").gold();
    expect(spent).toBe(2_000n);
  });

  test("repair stops when the owner can't pay", async () => {
    const { game, horde, wall } = await damagedWall({
      repairDelay: 0,
      repairInterval: 1,
      repairHp: 100,
      repairGoldPerHp: 1,
    });
    const survivor = game.player("survivor");
    survivor.removeGold(survivor.gold());
    run(game, 1);
    // A tick's income (100 gold) buys at most 100 health.
    expect(internals(horde).damage.get(wall.id())).toBeGreaterThanOrEqual(900);
  });

  test("damage on a unit that is gone is forgotten", async () => {
    const { game, horde, wall } = await damagedWall({
      repairDelay: 1_000,
      repairInterval: 1,
    });
    wall.delete(false);
    run(game, 2);
    expect(internals(horde).damage.size).toBe(0);
    expect(internals(horde).lastHit.size).toBe(0);
  });

  test("a snapshot mid-repair restores identically", async () => {
    const { game } = await damagedWall({
      repairDelay: 5,
      repairInterval: 3,
      repairHp: 50,
    });
    run(game, 7);
    await expectSnapshotRoundTrip(game, "plains", 30);
  });
});

describe("defence defaults and migration", () => {
  test("tiers get stronger and repair is on", () => {
    const o = DEFAULT_HORDE_OPTIONS;
    expect(o.wallHp).toBeLessThan(o.stoneWallHp);
    expect(o.stoneWallHp).toBeLessThan(o.reinforcedWallHp);
    expect(o.repairHp).toBeGreaterThan(0);
  });

  test("a version 5 snapshot migrates with every tier at the old wall health", () => {
    const v5 = {
      initialized: true,
      options: { wallHp: 10_000 },
      hpTiles: [5],
      hpValues: [3],
    };
    const v6 = HordeExecutionSnapshot.migrations[5](v5);
    expect(v6.options).toMatchObject({
      wallHp: 10_000,
      stoneWallHp: 10_000,
      reinforcedWallHp: 10_000,
      turretHighGroundBonus: 0,
      repairHp: 0,
    });
    expect(v6.damageIds).toEqual([]);
    expect(v6.lastHitIds).toEqual([]);
  });
});
