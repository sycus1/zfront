import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCountdown,
  HordeHud,
} from "../../../src/client/hud/layers/HordeHud";
import { WinModal } from "../../../src/client/hud/layers/WinModal";
import { SendWinnerEvent } from "../../../src/client/Transport";
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
    nextWave: 5,
    nextWaveShamblers: 90_000,
    nextWaveElites: 120,
    nextWaveSectors: 0b0000_0101,
    nextWaveFinal: false,
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

    expect(hud.querySelector("[data-horde-wave]")?.textContent).toContain(
      "horde_hud.wave_of",
    );
    expect(hud.querySelector("[data-horde-hq]")?.textContent?.trim()).toBe(
      "30%",
    );
    expect(
      hud.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
    ).toBe("30");
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
