import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import {
  DEFAULT_HORDE_OPTIONS,
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { TOWN_HORDE_OPTIONS } from "@openfront/engine/horde/TownScale";
import { playerInfo, setup } from "../util/Setup";

// The "plains" test map is 100x100 tiles of open land. A turret that kills
// nothing stands in the open with a city behind it, so the crowd presses on
// both.
const PRESS: Partial<HordeOptions> = {
  firstWaveDelay: 1,
  maxWaveTicks: 400,
  downtimeTicks: 0,
  waveCountdown: 0,
  firstWaveSize: 4_000,
  emittersPerWave: 4,
  emitRate: 200,
  elitesPerWave: 0,
  pressureShift: 4,
  shamblerSpeed: 1,
  turretKillsPerTick: 0,
  structureHp: 600,
  hqHp: 10_000_000,
  crateMax: 0,
};

async function pressedGame(
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
  survivor.buildUnit(UnitType.DefensePost, game.ref(50, 44), {});
  const horde = new HordeExecution(options);
  game.addExecution(horde);
  return { game, horde };
}

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) game.executeNextTick();
}

describe("turret health", () => {
  test("turrets have their own health, apart from other buildings", async () => {
    const weak = await pressedGame({ ...PRESS, turretHp: 600 });
    const tough = await pressedGame({ ...PRESS, turretHp: 10_000_000 });
    run(weak.game, 300);
    run(tough.game, 300);
    const w = weak.game.player("survivor");
    const t = tough.game.player("survivor");
    // With the same health as the city, the turret falls with it.
    expect(w.units(UnitType.DefensePost)).toHaveLength(0);
    expect(w.units(UnitType.City)).toHaveLength(0);
    // A tougher turret stands under the same crowd; the city's health
    // (structureHp) is the same in both games.
    expect(t.units(UnitType.DefensePost)).toHaveLength(1);
  });

  test("town turrets are much tougher than other town buildings", () => {
    expect(TOWN_HORDE_OPTIONS.turretHp).toBe(2_000);
    expect(TOWN_HORDE_OPTIONS.turretHp!).toBeGreaterThan(
      TOWN_HORDE_OPTIONS.structureHp! * 5,
    );
    // Continent maps keep the health every building had.
    expect(DEFAULT_HORDE_OPTIONS.turretHp).toBe(
      DEFAULT_HORDE_OPTIONS.structureHp,
    );
  });

  test("a version 17 snapshot keeps the turret health it had", () => {
    const v17 = { initialized: true, options: { structureHp: 300 }, wave: 2 };
    const v18 = HordeExecutionSnapshot.migrations[17](v17);
    expect(v18.options).toMatchObject({ structureHp: 300, turretHp: 300 });
  });
});
