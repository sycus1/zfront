import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import {
  OUTPOST_CLAIM_RADIUS,
  TOWN_OUTPOST_CLAIM_RADIUS,
  TOWN_TURRET_RANGE,
} from "@openfront/engine-lib/configuration/Config";
import {
  isTownScale,
  metresPerTile,
} from "@openfront/engine-lib/game/MapScale";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Game } from "@openfront/engine/game/Game";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import {
  hordeOptionsForMap,
  TOWN_HORDE_OPTIONS,
} from "@openfront/engine/horde/TownScale";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles (50x50 coarse cells) of open land.
const WAVES: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  maxWaveTicks: 400,
  firstWaveSize: 2_000,
  emittersPerWave: 4,
  emitRate: 200,
  elitesPerWave: 0,
  hqHp: 10_000_000,
  structureHp: 10_000_000,
  shamblerSpeed: 1,
};

async function hordeGame(
  options: Partial<HordeOptions>,
  turrets: [number, number][] = [],
): Promise<{ game: Game; horde: HordeExecution }> {
  const game = await setup("plains", {}, [
    playerInfo("survivor", PlayerType.Human),
  ]);
  const survivor = game.player("survivor");
  survivor.conquer(game.ref(50, 50));
  survivor.setSpawnTile(game.ref(50, 50));
  for (const [x, y] of turrets) {
    survivor.buildUnit(UnitType.DefensePost, game.ref(x, y), {});
  }
  const horde = new HordeExecution({ startingTurrets: 0, ...options });
  game.addExecution(horde);
  return { game, horde };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

/** Coarse-cell distance from the middle of the map to the furthest zombie. */
function furthestZombie(horde: HordeExecution): number {
  const field = (horde as unknown as { field: { density: Uint16Array } }).field;
  let far = 0;
  field.density.forEach((d, i) => {
    if (d === 0) return;
    const dx = (i % 50) - 25;
    const dy = Math.floor(i / 50) - 25;
    far = Math.max(far, Math.sqrt(dx * dx + dy * dy));
  });
  return far;
}

function config(map: GameMapType): EngineConfig {
  const gameConfig: GameConfig = {
    gameMap: map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    horde: true,
  };
  return new EngineConfig(gameConfig, false);
}

describe("Town scale", () => {
  test("town maps are told apart from continent maps", () => {
    expect(metresPerTile(GameMapType.Sheffield)).toBe(3);
    expect(isTownScale(GameMapType.Sheffield)).toBe(true);
    expect(isTownScale(GameMapType.Bath)).toBe(true);
    expect(isTownScale(GameMapType.Whitby)).toBe(true);
    expect(metresPerTile(GameMapType.Britannia)).toBe(0);
    expect(isTownScale(GameMapType.Britannia)).toBe(false);
  });

  test("town maps get the town horde numbers, continent maps the defaults", () => {
    expect(hordeOptionsForMap(GameMapType.Sheffield)).toBe(TOWN_HORDE_OPTIONS);
    expect(hordeOptionsForMap(GameMapType.Britannia)).toEqual({});
    // Every town number is a real option.
    for (const k of Object.keys(TOWN_HORDE_OPTIONS)) {
      expect(DEFAULT_HORDE_OPTIONS).toHaveProperty(k);
    }
  });

  test("previews show the turret range and Outpost claim of the map's scale", () => {
    const town = config(GameMapType.Sheffield);
    const continent = config(GameMapType.Britannia);
    expect(town.hordeTurretRange()).toBe(2 * TOWN_TURRET_RANGE);
    expect(town.hordeTurretRange()).toBe(
      2 * (TOWN_HORDE_OPTIONS.turretRange ?? 0),
    );
    expect(continent.hordeTurretRange()).toBe(
      2 * DEFAULT_HORDE_OPTIONS.turretRange,
    );
    expect(town.outpostClaimRadius()).toBe(TOWN_OUTPOST_CLAIM_RADIUS);
    expect(continent.outpostClaimRadius()).toBe(OUTPOST_CLAIM_RADIUS);
  });

  test("turrets fire in volleys every turretFireInterval ticks", async () => {
    const posts: [number, number][] = [[50, 44]];
    const opts = { ...WAVES, turretKillsPerTick: 4, turretRange: 30 };
    const everyTick = await hordeGame(opts, posts);
    const volleys = await hordeGame({ ...opts, turretFireInterval: 4 }, posts);
    run(everyTick.game, 40);
    run(volleys.game, 40);
    const fast = everyTick.horde.stats().killed;
    const slow = volleys.horde.stats().killed;
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(fast);
    // Shots show only on the ticks a volley goes off.
    let shotTicks = 0;
    for (let t = 0; t < 8; t++) {
      volleys.game.executeNextTick();
      if (volleys.horde.encodeFrame()!.turretShots.length > 0) shotTicks++;
    }
    expect(shotTicks).toBe(2);
  });

  test("inland spawns let waves rise away from the map edge", async () => {
    const band = { ...WAVES, minSpawnDistance: 6, maxSpawnDistance: 10 };
    const shore = await hordeGame({ ...band, inlandSpawns: 0 });
    const inland = await hordeGame({ ...band, inlandSpawns: 1 });
    run(shore.game, 3);
    run(inland.game, 3);
    expect(shore.horde.stats().alive).toBeGreaterThan(0);
    expect(inland.horde.stats().alive).toBeGreaterThan(0);
    // The plains map has no water, so without inland spawns waves start
    // at the map edge, 25 cells out.
    expect(furthestZombie(shore.horde)).toBeGreaterThan(20);
    expect(furthestZombie(inland.horde)).toBeLessThan(14);
  });

  test("a town-scale game round-trips through a snapshot", async () => {
    const { game } = await hordeGame(
      { ...TOWN_HORDE_OPTIONS, ...WAVES, firstWaveSize: 300 },
      [[50, 44]],
    );
    run(game, 30);
    await expectSnapshotRoundTrip(game, "plains", 30);
  });

  test("a version 14 snapshot migrates firing every tick from the shore", () => {
    const v14 = { initialized: true, options: { hqIncome: 50 }, wave: 1 };
    const v15 = HordeExecutionSnapshot.migrations[14](v14);
    expect(v15.options).toMatchObject({
      hqIncome: 50,
      turretFireInterval: 1,
      inlandSpawns: 0,
    });
  });
});
