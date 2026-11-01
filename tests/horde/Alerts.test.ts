import {
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { Game } from "@openfront/engine/game/Game";
import {
  ELITE_ALERT_INTERVAL,
  elitesAtWalls,
  maskSectors,
} from "@openfront/engine/horde/Alerts";
import { Elites } from "@openfront/engine/horde/Elites";
import {
  HordeExecution,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { playerInfo, setup } from "../util/Setup";

describe("elitesAtWalls", () => {
  // A 10x10 grid with the HQ at (5, 5).
  const w = 10;
  const at = (x: number, y: number) => y * w + x;
  const hq = at(5, 5);

  test("names the side of the HQ each wall with an elite at it is on", () => {
    const walls = new Set([at(5, 1), at(8, 5)]);
    const found = elitesAtWalls(
      // One elite north of the north wall, one east of the east wall, one
      // in the open.
      [at(5, 0), at(9, 5), at(2, 8)],
      (c) => walls.has(c),
      w,
      w,
      [hq],
    );
    // Bit 0 north, bit 2 east.
    expect(found.get(hq)).toBe(0b101);
  });

  test("finds nothing without walls, elites or an HQ", () => {
    const wall = (c: number) => c === at(5, 1);
    expect(elitesAtWalls([at(5, 0)], () => false, w, w, [hq]).size).toBe(0);
    expect(elitesAtWalls([], wall, w, w, [hq]).size).toBe(0);
    expect(elitesAtWalls([at(5, 0)], wall, w, w, []).size).toBe(0);
  });

  test("goes to the HQ nearest the wall", () => {
    const other = at(5, 0);
    const found = elitesAtWalls([at(1, 9)], (c) => c === at(1, 8), w, w, [
      other,
      hq,
    ]);
    expect([...found.keys()]).toEqual([hq]);
    // (1, 8) from (5, 5) is south-west: bit 5.
    expect(found.get(hq)).toBe(1 << 5);
  });

  test("lists sectors clockwise from north, up to a limit", () => {
    expect(maskSectors(0b1011_0001, 8)).toEqual([0, 4, 5, 7]);
    expect(maskSectors(0b1011_0001, 2)).toEqual([0, 4]);
  });
});

const QUIET: Partial<HordeOptions> = {
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
};

const WAVES: Partial<HordeOptions> = {
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

/** A horde survivor owning tiles 30..69 square, HQ at (50, 50). */
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

function messages(
  game: Game,
  ticks: number,
  beforeTick: () => void = () => {},
): DisplayMessageUpdate[] {
  const out: DisplayMessageUpdate[] = [];
  for (let t = 0; t < ticks; t++) {
    beforeTick();
    const updates = game.executeNextTick();
    out.push(
      ...(updates[GameUpdateType.DisplayEvent] as DisplayMessageUpdate[]),
    );
  }
  return out;
}

describe("horde alerts in a game", () => {
  test("a mine going off tells its owner how many it killed", async () => {
    const { game, horde } = await baseGame(WAVES);
    const survivor = game.player("survivor");
    const mine = survivor.buildUnit(UnitType.Mine, game.ref(36, 50), {});
    const seen: DisplayMessageUpdate[] = [];
    for (let t = 0; t < 400 && mine.isActive(); t++) {
      seen.push(...messages(game, 1));
    }
    expect(mine.isActive()).toBe(false);
    const sent = seen.filter(
      (m) => m.message === "events_display.mine_detonated",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].messageType).toBe(MessageType.HORDE_KILLS);
    expect(sent[0].playerID).toBe(survivor.smallID());
    // No turrets here: everything killed so far was the mine's.
    expect(sent[0].params?.kills).toBe(horde.stats().killed);
  });

  test("an elite at a wall is reported by the side it's on, every so often", async () => {
    const { game, horde } = await baseGame(QUIET);
    const survivor = game.player("survivor");
    // A wall post south of the HQ (coarse cell 25, 32), and an elite just
    // outside it. A lone post doesn't stop it walking round, so the test
    // holds it there.
    survivor.buildUnit(UnitType.Wall, game.ref(50, 64), {});
    messages(game, 2);
    const elites = (horde as unknown as { elites: Elites }).elites;
    const w = game.miniMap().width();
    elites.spawn(33 * w + 25, 1_000_000);
    const hold = () => {
      elites.cooldown[0] = 255;
    };

    const seen = messages(game, ELITE_ALERT_INTERVAL * 2, hold).filter(
      (m) => m.message === "events_display.elite_at_wall",
    );
    expect(seen).toHaveLength(2);
    expect(seen[0].messageType).toBe(MessageType.HORDE_THREAT);
    expect(seen[0].playerID).toBe(survivor.smallID());
    expect(seen[0].params?.direction).toBe("horde_direction_long.s");
  });

  test("no elite at a wall, no message", async () => {
    const { game } = await baseGame(QUIET);
    game.player("survivor").buildUnit(UnitType.Wall, game.ref(50, 64), {});
    const seen = messages(game, ELITE_ALERT_INTERVAL * 2).filter(
      (m) => m.message === "events_display.elite_at_wall",
    );
    expect(seen).toHaveLength(0);
  });
});
