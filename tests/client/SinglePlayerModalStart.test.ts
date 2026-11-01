import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

// Echo keys (plus interpolations) so assertions read as i18n keys.
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";
import { MAP_FACTS } from "../../src/client/components/nightshift/MapFacts";

function createModal(): any {
  return document.createElement("single-player-modal") as any;
}

describe("SinglePlayerModal start", () => {
  it("carries the selected team count and validated disabled units into the join-lobby config", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    // Team count is in the Advanced tile.
    modal.teamCount = 4;
    // One real unit and one junk entry: the start path must keep only
    // values that are actual UnitTypes.
    modal.disabledUnits = [UnitType.Warship, "Bogus"];

    await modal.startGame();

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("singleplayer");
    const config = events[0].gameStartInfo.config;
    expect(config.playerTeams).toBe(4);
    expect(config.disabledUnits).toEqual([UnitType.Warship]);
  });

  it("starts solo games with no AI players", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    await modal.startGame();

    const config = events[0].gameStartInfo.config;
    expect(config.bots).toBe(0);
    expect(config.nations).toBe("disabled");
    expect(config.horde).toBe(true);
  });
});

describe("SinglePlayerModal game rules", () => {
  async function start(setup: (modal: any) => void) {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );
    setup(modal);
    await modal.startGame();
    return events[0].gameStartInfo.config;
  }

  it("starts on Bath with every building allowed and no extras", async () => {
    const config = await start(() => {});
    expect(config.gameMap).toBe("Bath");
    expect(config.disabledUnits).toEqual([]);
    expect(config.startingGold).toBeUndefined();
    expect(config.goldMultiplier).toBeUndefined();
    expect(config.maxTimerValue).toBeUndefined();
    expect(config.overtime).toBeUndefined();
  });

  it("sends the economy fields as gold and a multiplier", async () => {
    const config = await start((m) => {
      m.startingGoldValue = 50_000;
      m.goldMultiplierValue = 1.5;
    });
    // Added on top of the horde's own starting gold, not in millions.
    expect(config.startingGold).toBe(50_000);
    expect(config.goldMultiplier).toBe(1.5);
  });

  it("turns the rules chips into config flags", async () => {
    const config = await start((m) => {
      m.instantBuild = true;
      m.infiniteGold = true;
      m.randomSpawn = true;
    });
    expect(config.instantBuild).toBe(true);
    expect(config.infiniteGold).toBe(true);
    expect(config.randomSpawn).toBe(true);
  });

  it("leaves out the buildings switched off", async () => {
    const config = await start((m) => {
      m.setUnitAllowed(UnitType.Mine, false);
      m.setUnitAllowed(UnitType.Wall, false);
      m.setUnitAllowed(UnitType.Wall, true);
    });
    expect(config.disabledUnits).toEqual([UnitType.Mine]);
  });

  it("clamps the game length and passes overtime from the Advanced tile", async () => {
    const config = await start((m) => {
      m.maxTimerValue = 500;
      m.overtimeStartMinutes = 20;
    });
    expect(config.maxTimerValue).toBe(120);
    expect(config.overtime).toEqual({ enabled: true, startMinutes: 20 });
  });
});

describe("SinglePlayerModal pages", () => {
  async function mount() {
    const modal = createModal();
    document.body.appendChild(modal);
    await modal.updateComplete;
    return modal;
  }

  it("opens on map selection with one card per map, Bath selected", async () => {
    const modal = await mount();
    expect(modal.querySelector("h1")?.textContent).toBe("zf_play.map_title");
    const cards = modal.querySelectorAll('.zf-maps [role="radio"]');
    expect(cards).toHaveLength(MAP_FACTS.length);
    const checked = modal.querySelector(
      '.zf-maps [role="radio"][aria-checked="true"]',
    );
    expect(checked?.textContent).toContain("map.bath");
    modal.remove();
  });

  it("selects a map from its card, then continues to the rules", async () => {
    const modal = await mount();
    const cards = modal.querySelectorAll('.zf-maps [role="radio"]');
    const whitby = Array.from(cards).find((c: any) =>
      c.textContent.includes("map.whitby"),
    ) as HTMLElement;
    whitby.click();
    await modal.updateComplete;
    expect(modal.selectedMap).toBe("Whitby");

    (modal.querySelector(".zf-strip-action button") as HTMLElement).click();
    await modal.updateComplete;
    expect(modal.step).toBe("setup");
    expect(modal.querySelector("h1")?.textContent).toBe("zf_play.setup_title");
    modal.remove();
  });

  it("shows difficulty, waves and interest but disabled", async () => {
    const modal = await mount();
    modal.step = "setup";
    await modal.updateComplete;
    const disabledTiles = modal.querySelectorAll("fieldset.zf-tile:disabled");
    expect(disabledTiles).toHaveLength(2);
    const interest = Array.from(modal.querySelectorAll('[role="switch"]')).find(
      (b: any) => b.textContent.includes("zf_play.rule_interest"),
    ) as HTMLButtonElement;
    expect(interest.disabled).toBe(true);
    modal.remove();
  });

  it("strikes through a building switched off and counts it in the briefing", async () => {
    const modal = await mount();
    modal.step = "setup";
    await modal.updateComplete;
    const chips = modal.querySelectorAll("[aria-pressed]");
    expect(chips).toHaveLength(7);
    (chips[0] as HTMLElement).click();
    await modal.updateComplete;
    expect(chips[0].getAttribute("aria-pressed")).toBe("false");
    expect(modal.querySelector(".zf-strip-items")?.textContent).toContain(
      'zf_play.summary_buildings_value:{"n":6,"total":7}',
    );
    modal.remove();
  });
});
