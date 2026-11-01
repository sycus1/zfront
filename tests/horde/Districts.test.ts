import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import {
  buildDistricts,
  DistrictState,
} from "@openfront/engine-lib/game/Districts";
import { Game, Player } from "@openfront/engine/game/Game";
import { Crate } from "@openfront/engine/horde/Crates";
import { Districts } from "@openfront/engine/horde/Districts";
import {
  HordeExecution,
  HordeExecutionSnapshot,
  HordeOptions,
} from "@openfront/engine/horde/HordeExecution";
import { HordeField } from "@openfront/engine/horde/HordeField";
import { WavePlan } from "@openfront/engine/horde/WaveDirector";
import { playerInfo, setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// The "plains" test map is 100x100 tiles of open plains, 50x50 coarse
// cells, cut into 5x5 districts of about 10 cells. The survivor owns the
// 40..59 tile square round the HQ at (50, 50). No wave comes, and nothing
// claims land but what a test builds.
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

async function districtGame(options: Partial<HordeOptions> = {}): Promise<{
  game: Game;
  survivor: Player;
  horde: HordeExecution;
}> {
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
  // Past the spawn phase, so the horde has started.
  run(game, 20);
  return { game, survivor, horde };
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

function internals(horde: HordeExecution) {
  return horde as unknown as {
    districts: Districts;
    field: HordeField;
    nextPlan: WavePlan | null;
    nextLandings: number[];
    crates: { all(): readonly Crate[] };
  };
}

/** The coarse cell of tile (x, y). */
function cell(x: number, y: number): number {
  return (y >> 1) * 50 + (x >> 1);
}

/** The frame state of the district holding tile (x, y). */
function stateAt(horde: HordeExecution, x: number, y: number): number {
  const d = internals(horde).districts.districtOf(cell(x, y));
  return horde.encodeFrame()!.districts[d];
}

describe("District map", () => {
  test("every cell belongs to a district, the same way every time", () => {
    const a = buildDistricts(50, 40, 10);
    const b = buildDistricts(50, 40, 10);
    expect(a.cols).toBe(5);
    expect(a.rows).toBe(4);
    expect(a.count).toBe(20);
    expect(Array.from(a.ids)).toEqual(Array.from(b.ids));
    const sizes = new Array(a.count).fill(0);
    for (const id of a.ids) {
      expect(id).toBeLessThan(a.count);
      sizes[id]++;
    }
    // Jittered, but every district keeps a fair share of the ground.
    for (const s of sizes) expect(s).toBeGreaterThan(30);
  });

  test("neighbours touch and go both ways", () => {
    const m = buildDistricts(50, 50, 10);
    m.neighbours.forEach((ns, d) => {
      expect(ns.length).toBeGreaterThanOrEqual(2);
      for (const n of ns) expect(m.neighbours[n]).toContain(d);
    });
  });

  test("size 0 turns districts off", () => {
    const m = buildDistricts(50, 50, 0);
    expect(m.size).toBe(0);
    expect(m.count).toBe(1);
  });
});

describe("Districts", () => {
  test("the HQ's district is Core, the open map is Wild", async () => {
    const { horde } = await districtGame();
    expect(stateAt(horde, 50, 50)).toBe(DistrictState.Core);
    expect(stateAt(horde, 5, 5)).toBe(DistrictState.Wild);
    expect(stateAt(horde, 95, 95)).toBe(DistrictState.Wild);
  });

  test("an Outpost secures its district once it's clear", async () => {
    const { game, survivor, horde } = await districtGame();
    survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    run(game, 20);
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Securing);
    const messages = run(game, 50);
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Held);
    expect(
      messages.some((m) => m.message === "events_display.district_secured"),
    ).toBe(true);
  });

  test("zombies in the district hold up securing it", async () => {
    const { game, survivor, horde } = await districtGame();
    const outpost = survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    const { field } = internals(horde);
    for (let t = 0; t < 8; t++) {
      // Keep a straggler on the Outpost's doorstep.
      field.add(cell(70, 50), 1);
      run(game, 10);
    }
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Securing);
    expect(outpost.isActive()).toBe(true);
  });

  test("a crowd that stays overruns a Held district and takes its Outpost", async () => {
    const { game, survivor, horde } = await districtGame();
    survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    run(game, 80);
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Held);
    const { field } = internals(horde);
    field.add(cell(70, 50), 40);
    run(game, 10);
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Threatened);
    const messages = run(game, 40);
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Wild);
    expect(survivor.units(UnitType.Outpost).length).toBe(0);
    expect(
      messages.some((m) => m.message === "events_display.district_overrun"),
    ).toBe(true);
  });

  test("the horde doesn't make for an Outpost", async () => {
    const { game, survivor, horde } = await districtGame();
    const outpost = survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    const { field } = internals(horde);
    // A crowd that passes by on its way to the HQ leaves it standing.
    field.add(cell(74, 50), 10);
    run(game, 120);
    expect(outpost.isActive()).toBe(true);
  });

  test("losing the Outpost gives the district back to the wild", async () => {
    const { game, survivor, horde } = await districtGame();
    const outpost = survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    run(game, 80);
    outpost.delete(false);
    run(game, 10);
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Wild);
  });

  test("no wave rises in a Held district", async () => {
    // Waves may rise anywhere 10 to 20 cells from the HQ: a ring that the
    // Held district east of it cuts into.
    const { game, survivor, horde } = await districtGame({
      inlandSpawns: 1,
      minSpawnDistance: 10,
      maxSpawnDistance: 20,
      emittersPerWave: 64,
    });
    const i = internals(horde);
    expect(i.nextPlan).not.toBeNull();
    survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    run(game, 80);
    expect(stateAt(horde, 68, 50)).toBe(DistrictState.Held);
    expect(i.nextLandings.length).toBeGreaterThan(0);
    for (const c of i.nextLandings) {
      expect(i.districts.blocksSpawn(c)).toBe(false);
    }
  });

  test("a Held district keeps waves off its neighbours too", async () => {
    const { game, survivor, horde } = await districtGame();
    survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    run(game, 80);
    const { districts } = internals(horde);
    const held = districts.districtOf(cell(68, 50));
    expect(districts.blocksSpawn(cell(68, 50))).toBe(true);
    for (const n of districts.map.neighbours[held]) {
      const c = districts.map.ids.indexOf(n);
      expect(districts.blocksSpawn(c)).toBe(true);
    }
    // Far corners stay open.
    expect(districts.blocksSpawn(cell(2, 2))).toBe(false);
    expect(districts.blocksSpawn(cell(2, 98))).toBe(false);
  });

  test("crates drop only in or next to the player's districts", async () => {
    const { game, survivor, horde } = await districtGame({
      crateInterval: 5,
      crateMax: 50,
      crateLife: 10_000,
      crateMinDistance: 2,
      crateMaxDistance: 40,
    });
    run(game, 400);
    const { districts, crates } = internals(horde);
    const all = crates.all();
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      const x = game.x(c.tile);
      const y = game.y(c.tile);
      expect(districts.crateSpot(cell(x, y), survivor.smallID())).not.toBe(0);
    }
  });

  test("a crate in a Held district is worth more", async () => {
    const { game, survivor, horde } = await districtGame();
    survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    run(game, 80);
    const { districts } = internals(horde);
    const id = survivor.smallID();
    expect(districts.crateSpot(cell(68, 50), id)).toBe(2);
    expect(districts.crateSpot(cell(50, 50), id)).toBe(1);
    expect(districts.crateSpot(cell(2, 98), id)).toBe(0);
  });

  test("districts are off unless asked for", async () => {
    const { horde } = await districtGame({ districtSize: 0 });
    const frame = horde.encodeFrame()!;
    expect(frame.districtSize).toBe(0);
    expect(frame.districts.length).toBe(0);
    expect(internals(horde).districts.crateSpot(cell(2, 2), 1)).toBe(1);
  });

  test("a snapshot with Held districts restores and keeps ticking", async () => {
    const { game, survivor } = await districtGame();
    survivor.buildUnit(UnitType.Outpost, game.ref(68, 50), {});
    run(game, 40);
    await expectSnapshotRoundTrip(game, "plains", 60);
  });

  test("a version 18 snapshot migrates with districts off", () => {
    const v18 = { initialized: true, options: { hqIncome: 50 }, wave: 1 };
    const v19 = HordeExecutionSnapshot.migrations[18](v18);
    expect(v19.options).toMatchObject({
      hqIncome: 50,
      districtSize: 0,
      crateHeldBonusPercent: 0,
    });
    expect(v19.districts).toBeNull();
  });
});
