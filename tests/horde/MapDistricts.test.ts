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
  decodeMapDistricts,
  districtMap,
  DistrictState,
  MapDistrictIds,
  scaleMapDistricts,
} from "@openfront/engine-lib/game/Districts";
import { hordeMoveCost } from "@openfront/engine-lib/game/HordeTerrain";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { Game, Player } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import { Districts } from "@openfront/engine/horde/Districts";
import {
  HordeExecution,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";
import { playerInfo } from "../util/Setup";
import { expectSnapshotRoundTrip, loadTestMaps } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Map districts", () => {
  test("rows decode run by run", () => {
    const own = decodeMapDistricts(
      { count: 3, rows: ["0*2 1*2", "0*1 2*3"] },
      4,
      2,
    );
    expect(own.count).toBe(3);
    expect(Array.from(own.ids)).toEqual([0, 0, 1, 1, 0, 2, 2, 2]);
  });

  test("bad rows are refused", () => {
    const bad =
      (rows: string[], count = 2) =>
      () =>
        decodeMapDistricts({ count, rows }, 4, 2);
    expect(bad(["0*4"])).toThrow(/rows/);
    expect(bad(["0*4", "1*3"])).toThrow(/covers 3 of 4/);
    expect(bad(["0*4", "1*5"])).toThrow(/bad run/);
    expect(bad(["0*4", "2*4"])).toThrow(/bad run/);
    expect(bad(["0*4", "x"])).toThrow(/bad run/);
    expect(bad(["0*4", "1*4"], 0)).toThrow(/count/);
  });

  test("a compact game's grid takes each cell's top-left district", () => {
    const own = decodeMapDistricts(
      { count: 2, rows: ["0*2 1*2", "1*4"] },
      4,
      2,
    );
    const half = scaleMapDistricts(own, 2, 1);
    expect(half.count).toBe(2);
    expect(Array.from(half.ids)).toEqual([0, 1]);
  });

  test("the map's own districts are used on their grid, the jittered grid elsewhere", () => {
    const own = decodeMapDistricts(
      { count: 2, rows: ["0*2 1*2", "0*2 1*2"] },
      4,
      2,
    );
    const m = districtMap(4, 2, 10, own);
    expect(m.handMade).toBe(true);
    expect(m.count).toBe(2);
    expect(m.neighbours).toEqual([[1], [0]]);
    expect(districtMap(40, 20, 10, own).handMade).toBe(false);
    expect(districtMap(40, 20, 10).count).toBe(8);
    // Size 0 turns them off, whatever the map has.
    const off = districtMap(4, 2, 0, own);
    expect(off.size).toBe(0);
    expect(off.count).toBe(1);
  });

  test.each([GameMapType.Bath, GameMapType.Sheffield, GameMapType.Whitby])(
    "%s has its own districts, each one piece with open ground",
    async (map) => {
      const loader = new NodeGameMapLoader(
        path.join(__dirname, "../../resources/maps"),
      );
      const terrain = await loadTerrainMap(
        await loadMapFiles(loader, map, GameMapSize.Normal),
      );
      const own = terrain.districts!;
      const mini = terrain.miniGameMap;
      expect(own).toBeDefined();
      expect(own.width).toBe(mini.width());
      expect(own.height).toBe(mini.height());
      // Roughly as many as the town's 25-cell grid would give.
      expect(own.count).toBeGreaterThan(30);
      expect(own.count).toBeLessThan(100);

      const w = own.width;
      const h = own.height;
      const cells = new Array(own.count).fill(0);
      const open = new Array(own.count).fill(0);
      for (let c = 0; c < w * h; c++) {
        cells[own.ids[c]]++;
        const t = mini.terrainByte(mini.ref(c % w, Math.floor(c / w)));
        if (hordeMoveCost(t) !== 0) open[own.ids[c]]++;
      }
      for (let d = 0; d < own.count; d++) {
        expect(open[d]).toBeGreaterThan(0);
        expect(pieceSize(own, d)).toBe(cells[d]);
      }
    },
  );
});

/** Cells 4-connected to district `d`'s first cell. */
function pieceSize(own: MapDistrictIds, d: number): number {
  const { width: w, height: h, ids } = own;
  const start = ids.indexOf(d);
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  let n = 0;
  while (stack.length > 0) {
    const c = stack.pop()!;
    n++;
    const x = c % w;
    const y = (c - x) / w;
    for (const nc of [
      y > 0 ? c - w : -1,
      x > 0 ? c - 1 : -1,
      x + 1 < w ? c + 1 : -1,
      y + 1 < h ? c + w : -1,
    ]) {
      if (nc >= 0 && !seen[nc] && ids[nc] === d) {
        seen[nc] = 1;
        stack.push(nc);
      }
    }
  }
  return n;
}

// The "plains" test map is 50x50 coarse cells. These hand-made districts
// are three bands: west (x < 20), middle (20..29, with the HQ at tile
// (50, 50)) and east (x >= 30).
function bands(): MapDistrictIds {
  const rows = new Array(50).fill("0*20 1*10 2*20");
  return decodeMapDistricts({ count: 3, rows }, 50, 50);
}

const QUIET: Partial<HordeOptions> = {
  startingGold: 0,
  startingRadius: 0,
  firstWaveDelay: 10_000,
  hqIncome: 0,
  flowDebounce: 0,
  crateInterval: 0,
  settleTiles: 0,
  outpostRadius: 1,
  buildingClaimRadius: 0,
  districtSize: 10,
  districtSecureTicks: 50,
  districtOverrunCount: 20,
  districtOverrunTicks: 30,
  districtCorePercent: 60,
};

async function bandGame(): Promise<{
  game: Game;
  survivor: Player;
  horde: HordeExecution;
}> {
  const { gameMap, miniGameMap } = await loadTestMaps("plains");
  const gameConfig: GameConfig = {
    gameMap: GameMapType.Britannia,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    horde: true,
  };
  const game = createGame(
    [playerInfo("survivor", PlayerType.Human)],
    [],
    gameMap,
    miniGameMap,
    new TestConfig(gameConfig, false),
    undefined,
    bands(),
  );
  game.endSpawnPhase();
  const survivor = game.player("survivor");
  for (let y = 40; y < 60; y++) {
    for (let x = 40; x < 60; x++) survivor.conquer(game.ref(x, y));
  }
  survivor.setSpawnTile(game.ref(50, 50));
  const horde = new HordeExecution(QUIET);
  game.addExecution(horde);
  for (let t = 0; t < 20; t++) game.executeNextTick();
  return { game, survivor, horde };
}

function districtsOf(horde: HordeExecution): Districts {
  return (horde as unknown as { districts: Districts }).districts;
}

describe("Hand-made districts in a game", () => {
  test("the horde uses the map's districts instead of the grid", async () => {
    const { horde } = await bandGame();
    const districts = districtsOf(horde);
    expect(districts.map.handMade).toBe(true);
    const frame = horde.encodeFrame()!;
    expect(frame.districtSize).toBeGreaterThan(0);
    expect(Array.from(frame.districts)).toEqual([
      DistrictState.Wild,
      DistrictState.Core,
      DistrictState.Wild,
    ]);
  });

  test("an Outpost holds a whole hand-made district", async () => {
    const { game, survivor, horde } = await bandGame();
    survivor.buildUnit(UnitType.Outpost, game.ref(80, 50), {});
    for (let t = 0; t < 80; t++) game.executeNextTick();
    const frame = horde.encodeFrame()!;
    expect(frame.districts[2]).toBe(DistrictState.Held);
    // The far corner of the band is held too, and keeps waves off.
    expect(districtsOf(horde).blocksSpawn(49 * 50 + 49)).toBe(true);
  });

  test("a snapshot restores onto the same districts", async () => {
    const { game, survivor } = await bandGame();
    survivor.buildUnit(UnitType.Outpost, game.ref(80, 50), {});
    for (let t = 0; t < 40; t++) game.executeNextTick();
    const restored = await expectSnapshotRoundTrip(game, "plains", 60);
    expect(restored.mapDistricts()?.count).toBe(3);
  });
});
