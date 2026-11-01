import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCountdown,
  HordeHud,
} from "../../../src/client/hud/layers/HordeHud";
import { WinModal } from "../../../src/client/hud/layers/WinModal";
import { TogglePauseIntentEvent } from "../../../src/client/InputHandler";
import {
  hordeBlobs,
  MAX_BLOB_LABELS,
  crateAt,
  crateMarkers,
  MAX_CRATES,
  MAX_SHOTS,
  turretTracers,
  mortarShells,
  MAX_SHELLS,
  waveArrows,
} from "../../../src/client/render/gl/passes/HordePass";
import {
  SendCallWaveIntentEvent,
  SendWinnerEvent,
} from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

function frame(overrides: Partial<HordeFrame> = {}): HordeFrame {
  return {
    width: 1,
    height: 1,
    cells: new Uint8Array(1),
    alive: 12_500,
    elites: 3,
    wave: 4,
    wavesToWin: 10,
    killed: 34_000,
    structuresDestroyed: 2,
    outcome: "playing",
    hqHp: 15_000,
    hqMaxHp: 50_000,
    nextWaveIn: 230,
    clearing: false,
    clearLeft: 0,
    downtimeIn: 0,
    nextWave: 5,
    nextWaveShamblers: 90_000,
    nextWaveElites: 120,
    nextWaveSectors: 0b0000_0101,
    nextWaveFinal: false,
    nextWaveLandings: new Int32Array(),
    hqCell: -1,
    hqTile: -1,
    settleRadius: 0,
    turretShots: new Int32Array(),
    structureHp: new Int32Array(),
    mortarShells: new Int32Array(),
    mortarBlasts: new Int32Array(),
    mortarBlastRadius: 2,
    canCallWave: false,
    callWaveGold: 0,
    crates: new Int32Array(),
    crateLootTicks: 50,
    crateLife: 300,
    encodeMs: 0,
    sentAt: 0,
    ...overrides,
  };
}

function hordeGame(opts: {
  status: HordeFrame | null;
  winUpdates?: unknown[];
  horde?: boolean;
}): GameView {
  return {
    config: () => ({ gameConfig: () => ({ horde: opts.horde ?? true }) }),
    hordeStatus: () => opts.status,
    myPlayer: () => ({
      clientID: () => "me",
      isAlive: () => false,
      hasSpawned: () => true,
      gold: () => 412_000n,
    }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => ({
      [GameUpdateType.Win]: opts.winUpdates ?? [],
    }),
  } as unknown as GameView;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HordeHud", () => {
  it("shows the wave out of the total and the HQ health", async () => {
    const hud = new HordeHud();
    hud.game = hordeGame({ status: frame() });
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;

    const wave = hud.querySelector("[data-horde-wave]")?.textContent ?? "";
    expect(wave).toContain("04");
    expect(wave).toContain("/ 10");
    expect(hud.querySelector("[data-horde-hq]")?.textContent?.trim()).toBe(
      "30%",
    );
    expect(
      hud.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
    ).toBe("30");
    // Three of ten blocks lit, in red at 30%.
    const bar = hud.querySelector(".zf-hq-bar");
    expect(bar?.classList).toContain("zf-hq-bar-low");
    expect(bar?.querySelectorAll(".zf-on")).toHaveLength(3);
  });

  it("marks waves past the total as endless", async () => {
    const hud = new HordeHud();
    hud.game = hordeGame({ status: frame({ wave: 12, wavesToWin: 10 }) });
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;

    const wave = hud.querySelector("[data-horde-wave]")?.textContent ?? "";
    expect(wave).toContain("12");
    expect(wave).toContain("horde_hud.endless");
  });

  it("shows HQ UNDER ATTACK after the HQ loses health, then drops it", async () => {
    vi.useFakeTimers();
    try {
      const status = { current: frame({ hqHp: 40_000 }) };
      const hud = new HordeHud();
      hud.game = {
        ...hordeGame({ status: null }),
        hordeStatus: () => status.current,
      } as GameView;
      document.body.append(hud);
      hud.tick();
      await hud.updateComplete;
      expect(hud.querySelector("[data-horde-hq-alert]")).toBeNull();

      status.current = frame({ hqHp: 39_000 });
      hud.tick();
      await hud.updateComplete;
      const alert = hud.querySelector("[data-horde-hq-alert]");
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(alert?.textContent).toContain("horde_hud.hq_under_attack");

      // No more hits: it goes after a few seconds.
      vi.advanceTimersByTime(5000);
      status.current = frame({ hqHp: 39_000 });
      hud.tick();
      await hud.updateComplete;
      expect(hud.querySelector("[data-horde-hq-alert]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("points the compass at the sides the wave comes from", async () => {
    const hud = new HordeHud();
    hud.game = hordeGame({ status: frame() });
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;

    const arrows = Array.from(hud.querySelectorAll("svg[role=img] polygon"));
    expect(arrows).toHaveLength(8);
    const red = arrows.map((a) => a.getAttribute("fill")?.includes("horde"));
    // Sectors 0b101: north and east.
    expect(red).toEqual([true, false, true, false, false, false, false, false]);
  });

  it("asks to toggle pause from the phone header", async () => {
    const hud = new HordeHud();
    const bus = new EventBus();
    const toggles: TogglePauseIntentEvent[] = [];
    bus.on(TogglePauseIntentEvent, (e) => toggles.push(e));
    hud.game = hordeGame({ status: frame() });
    hud.eventBus = bus;
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;

    hud.querySelector<HTMLButtonElement>(".zf-wave-pause")!.click();
    expect(toggles).toHaveLength(1);
  });

  it("announces the next wave's countdown, directions and size", async () => {
    const hud = new HordeHud();
    hud.game = hordeGame({ status: frame() });
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;

    const next = hud.querySelector("[data-horde-next]")?.textContent ?? "";
    expect(next).toContain("horde_hud.next_wave");
    expect(next).toContain("horde_hud.next_size");
    // Sectors 0b101: north and east.
    expect(hud.querySelector("[data-horde-from]")?.textContent).toContain(
      "horde_hud.from",
    );
  });

  it("calls out the final wave and the countdown to victory", async () => {
    const final = new HordeHud();
    final.game = hordeGame({
      status: frame({
        nextWave: 10,
        nextWaveFinal: true,
        nextWaveSectors: 0xff,
      }),
    });
    const last = new HordeHud();
    last.game = hordeGame({ status: frame({ nextWave: 0, wave: 10 }) });
    document.body.append(final, last);
    final.tick();
    last.tick();
    await final.updateComplete;
    await last.updateComplete;

    expect(final.querySelector("[data-horde-next]")?.textContent).toContain(
      "horde_hud.final_wave",
    );
    expect(final.querySelector("[data-horde-from]")?.textContent?.trim()).toBe(
      "horde_hud.from_everywhere",
    );
    expect(last.querySelector("[data-horde-next]")?.textContent).toContain(
      "horde_hud.victory_in",
    );
  });

  it("formats the countdown as minutes and seconds", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(5)).toBe("0:01");
    expect(formatCountdown(230)).toBe("0:23");
    expect(formatCountdown(905)).toBe("1:31");
  });

  it("stays hidden before the first horde frame and outside horde games", async () => {
    const waiting = new HordeHud();
    waiting.game = hordeGame({ status: null });
    const classic = new HordeHud();
    classic.game = hordeGame({ status: frame(), horde: false });
    document.body.append(waiting, classic);
    waiting.tick();
    classic.tick();
    await waiting.updateComplete;
    await classic.updateComplete;

    expect(waiting.querySelector("[data-horde-hud]")).toBeNull();
    expect(classic.querySelector("[data-horde-hud]")).toBeNull();
  });
});

describe("calling the next wave", () => {
  it("offers the early call with its bonus once the wave can be called", async () => {
    const hud = new HordeHud();
    const bus = new EventBus();
    const calls: SendCallWaveIntentEvent[] = [];
    bus.on(SendCallWaveIntentEvent, (e) => calls.push(e));
    hud.game = hordeGame({
      status: frame({ canCallWave: true, callWaveGold: 23_000 }),
    });
    hud.eventBus = bus;
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;

    const button = hud.querySelector<HTMLButtonElement>("[data-horde-call]");
    expect(button?.textContent).toContain("horde_hud.call_wave");
    button!.click();
    expect(calls).toHaveLength(1);
  });

  it("hides the button while the wave can't be called", async () => {
    const hud = new HordeHud();
    hud.game = hordeGame({ status: frame({ canCallWave: false }) });
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;

    expect(hud.querySelector("[data-horde-call]")).toBeNull();
  });
});

describe("downtime between waves", () => {
  async function render(status: HordeFrame): Promise<HordeHud> {
    const hud = new HordeHud();
    hud.game = hordeGame({ status });
    document.body.append(hud);
    hud.tick();
    await hud.updateComplete;
    return hud;
  }

  it("asks for the clear while the wave under way holds up the next", async () => {
    const hud = await render(
      frame({ clearing: true, clearLeft: 340, nextWaveIn: -1 }),
    );
    const clearing = hud.querySelector("[data-horde-clearing]");
    expect(clearing?.textContent).toContain("horde_hud.clear_first");
    // The next wave is still shown, with no countdown yet.
    expect(hud.querySelector("[data-horde-next]")?.textContent).toContain(
      "horde_hud.next_after_clear",
    );
    expect(hud.querySelector("[data-horde-downtime]")).toBeNull();
  });

  it("asks for the clear to win on the final wave", async () => {
    const hud = await render(
      frame({ clearing: true, clearLeft: 12, nextWaveIn: -1, nextWave: 0 }),
    );
    expect(hud.querySelector("[data-horde-clearing]")?.textContent).toContain(
      "horde_hud.clear_to_win",
    );
  });

  it("shows the build time left, then just the countdown", async () => {
    const building = await render(frame({ downtimeIn: 600, nextWaveIn: 900 }));
    expect(
      building.querySelector("[data-horde-downtime]")?.textContent,
    ).toContain("horde_hud.build_time");
    expect(building.querySelector("[data-horde-clearing]")).toBeNull();
    const counting = await render(frame({ downtimeIn: 0, nextWaveIn: 200 }));
    expect(counting.querySelector("[data-horde-downtime]")).toBeNull();
    expect(counting.querySelector("[data-horde-next]")?.textContent).toContain(
      "horde_hud.next_wave",
    );
  });
});

describe("wave arrows", () => {
  it("point from each landing at the HQ", () => {
    // A 10x10 grid with the HQ at (5, 5) and landings due north and west.
    const arrows = waveArrows(
      frame({
        width: 10,
        height: 10,
        hqCell: 55,
        nextWaveLandings: Int32Array.from([5, 50]),
      }),
    );
    expect(Array.from(arrows)).toEqual([5.5, 0.5, 0, 1, 0.5, 5.5, 1, 0]);
  });

  it("are hidden with no wave announced, no HQ, or the game over", () => {
    const landings = Int32Array.from([5]);
    const base = {
      width: 10,
      height: 10,
      hqCell: 55,
      nextWaveLandings: landings,
    };
    expect(waveArrows(frame({ ...base, nextWave: 0 }))).toHaveLength(0);
    expect(waveArrows(frame({ ...base, hqCell: -1 }))).toHaveLength(0);
    expect(waveArrows(frame({ ...base, outcome: "lost" }))).toHaveLength(0);
  });
});

describe("horde blob counts", () => {
  it("splits the alive count between separate blobs by density", () => {
    // 6x3 grid: a two-cell blob on the left (density 3 + 3), a one-cell blob
    // with an elite next to it on the right, and a wall that isn't horde.
    const cells = new Uint8Array(18);
    cells[0] = 3;
    cells[7] = 3; // diagonal neighbour of cell 0
    cells[4] = 2;
    cells[11] = 255;
    cells[15] = 253;
    const blobs = hordeBlobs(frame({ width: 6, height: 3, cells, alive: 64 }));
    expect(blobs).toEqual([
      // Cells (0,0) and (1,1): centre (1,1) in cells, (1.5,1.5) in tiles.
      { x: 1.5, y: 1.5, count: 48 },
      // Cell (4,0) weight 2 and the elite at (5,1) weight 1.
      {
        x: ((4.5 * 2 + 5.5) / 3) * 2 - 0.5,
        y: ((0.5 * 2 + 1.5) / 3) * 2 - 0.5,
        count: 17,
      },
    ]);
  });

  it("drops empty blobs and keeps only the largest", () => {
    const n = MAX_BLOB_LABELS + 10;
    // Isolated single cells every other column.
    const cells = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) cells[i * 2] = i === 0 ? 50 : 1;
    const blobs = hordeBlobs(
      frame({ width: n * 2, height: 1, cells, alive: 1000, elites: 0 }),
    );
    expect(blobs).toHaveLength(MAX_BLOB_LABELS);
    expect(blobs[0].x).toBe(0.5);
    expect(
      hordeBlobs(
        frame({ width: 1, height: 1, cells: Uint8Array.of(1), alive: 0 }),
      ),
    ).toEqual([]);
  });
});

describe("WinModal in a horde game", () => {
  function modal(game: GameView): { modal: WinModal; bus: EventBus } {
    const m = new WinModal();
    const bus = new EventBus();
    m.game = game;
    m.eventBus = bus;
    document.body.append(m);
    return { modal: m, bus };
  }

  it("shows the zfront result with the run's stats when the HQ falls", async () => {
    const votes: SendWinnerEvent[] = [];
    const { modal: m, bus } = modal(
      hordeGame({
        status: frame({ wave: 6, outcome: "lost", hqHp: 0 }),
        winUpdates: [
          {
            type: GameUpdateType.Win,
            winner: undefined,
            allPlayersStats: {},
          },
        ],
      }),
    );
    bus.on(SendWinnerEvent, (e) => votes.push(e));
    m.tick();
    await m.updateComplete;

    expect(m.isVisible).toBe(true);
    expect(m.querySelector("h2")?.textContent).toContain(
      "horde_result.lost_title",
    );
    expect(m.textContent).not.toContain("win_modal.match_cancelled");
    expect(m.textContent).not.toContain("win_modal.died");
    expect(m.querySelector('[data-horde-stat="waves"]')?.textContent).toContain(
      "6 / 10",
    );
    expect(
      m.querySelector('[data-horde-stat="killed"]')?.textContent,
    ).toContain("34");
    expect(votes).toHaveLength(1);
  });

  it("shows the win when every wave was survived", async () => {
    const { modal: m } = modal(
      hordeGame({
        status: frame({ wave: 10, outcome: "won" }),
        winUpdates: [
          {
            type: GameUpdateType.Win,
            winner: ["player", "me"],
            allPlayersStats: {},
          },
        ],
      }),
    );
    vi.spyOn(history, "replaceState").mockImplementation(() => {});
    m.tick();
    await m.updateComplete;

    expect(m.querySelector("h2")?.textContent).toContain(
      "horde_result.won_title",
    );
    expect(m.querySelector('[data-horde-stat="waves"]')?.textContent).toContain(
      "10 / 10",
    );
  });
});

describe("turret tracers", () => {
  it("run from each firing turret's cell centre to its target's", () => {
    const tracers = turretTracers(
      frame({ width: 10, height: 10, turretShots: Int32Array.from([55, 23]) }),
    );
    expect(Array.from(tracers)).toEqual([5.5, 5.5, 3.5, 2.5]);
  });

  it("are capped and empty when nothing fires", () => {
    expect(turretTracers(frame({}))).toHaveLength(0);
    const many = new Int32Array(2 * (MAX_SHOTS + 5));
    expect(turretTracers(frame({ turretShots: many }))).toHaveLength(
      MAX_SHOTS * 4,
    );
  });
});

describe("mortar shells", () => {
  // Fired from cell 0 (0.5, 0.5) at cell 9 (9.5, 0.5) on a 10-wide grid,
  // with 5 of its 10 ticks of flight left.
  const shells = Int32Array.from([0, 9, 5, 10]);

  it("arc over their shadow, which they meet when they land", () => {
    const mid = mortarShells({ width: 10, mortarShells: shells }, 0);
    // Half way, at the top of an arc 0.35 of the 9-cell shot high.
    expect(mid[0]).toBeCloseTo(5);
    expect(mid[1]).toBeCloseTo(0.5 - 9 * 0.35);
    expect(Array.from(mid.subarray(2))).toEqual([5, 0.5]);
    // Half a second (5 ticks) on, it has landed.
    const landed = mortarShells({ width: 10, mortarShells: shells }, 0.5);
    expect(Array.from(landed)).toEqual([9.5, 0.5, 9.5, 0.5]);
  });

  it("are capped", () => {
    const many = new Int32Array(4 * (MAX_SHELLS + 3));
    expect(mortarShells({ width: 10, mortarShells: many }, 0)).toHaveLength(
      MAX_SHELLS * 4,
    );
  });
});

describe("supply crates", () => {
  // Map 100 tiles wide: crate 7 on tile (30, 20), half looted; crate 8 on
  // tile (70, 80), untouched with 150 of its 300 ticks left.
  const crates = Int32Array.from([
    7,
    20 * 100 + 30,
    3_500,
    0,
    25,
    8,
    80 * 100 + 70,
    5_000,
    150,
    -1,
  ]);

  it("carry their tile, gold, loot progress and life left", () => {
    expect(crateMarkers(frame({ crates }), 100)).toEqual([
      { id: 7, x: 30, y: 20, gold: 3_500, looted: 0.5, life: 0 },
      { id: 8, x: 70, y: 80, gold: 5_000, looted: -1, life: 0.5 },
    ]);
  });

  it("are capped", () => {
    const many = new Int32Array(5 * (MAX_CRATES + 3));
    expect(crateMarkers(frame({ crates: many }), 100)).toHaveLength(MAX_CRATES);
  });

  it("a click picks the nearest crate within reach, or none", () => {
    const f = frame({ crates });
    expect(crateAt(f, 100, 31, 21)).toBe(7);
    expect(crateAt(f, 100, 70, 84)).toBe(8);
    expect(crateAt(f, 100, 50, 50)).toBe(-1);
  });
});
