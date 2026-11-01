import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import {
  HORDE_BUILD_ITEMS,
  UnitDisplay,
} from "../../src/client/hud/layers/UnitDisplay";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";

function game(horde: boolean, gold: bigint): GameView {
  const costs: Partial<Record<UnitType, bigint>> = {
    [UnitType.Wall]: 5_000n,
    [UnitType.DefensePost]: 50_000n,
    [UnitType.MissileSilo]: 100_000n,
  };
  const player = {
    isAlive: () => true,
    gold: () => gold,
    units: () => [],
    buildables: async () =>
      Object.entries(costs).map(([type, cost]) => ({ type, cost })),
  };
  return {
    config: () => ({
      horde: () => horde,
      isUnitDisabled: () => false,
      maxUnitLevel: (t: UnitType) =>
        t === UnitType.DefensePost ? 3 : Number.MAX_SAFE_INTEGER,
    }),
    myPlayer: () => player,
    inSpawnPhase: () => false,
  } as unknown as GameView;
}

async function mount(horde: boolean, gold = 60_000n) {
  const display = new UnitDisplay();
  display.game = game(horde, gold);
  display.eventBus = new EventBus();
  display.uiState = { ghostStructure: null } as UIState;
  document.body.append(display);
  display.init();
  display.tick();
  await Promise.resolve();
  display.requestUpdate();
  await display.updateComplete;
  return display;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("unit-display build strip", () => {
  it("offers the horde's seven buildings in the board's order", async () => {
    const display = await mount(true);
    // Each button carries its default key: Wall V, Turret 4, Mortar 5,
    // Mine K, Noise Beacon L, Depot H, Outpost O.
    const keys = Array.from(display.querySelectorAll(".zf-build-key")).map(
      (k) => k.textContent?.trim(),
    );
    expect(keys).toHaveLength(HORDE_BUILD_ITEMS.length);
    expect(keys).toEqual(["V", "4", "5", "K", "L", "H", "O"]);
  });

  it("keeps OpenFront's units outside horde games", async () => {
    const display = await mount(false);
    const keys = Array.from(display.querySelectorAll(".zf-build-key")).map(
      (k) => k.textContent?.trim(),
    );
    // City (1), Factory (2) and Port (3) come first.
    expect(keys.slice(0, 3)).toEqual(["1", "2", "3"]);
  });

  it("selects an affordable building and names it in the tag", async () => {
    const display = await mount(true);
    const turret = display.querySelectorAll<HTMLButtonElement>("nav button")[1];
    turret.click();
    await display.updateComplete;

    expect(display.uiState.ghostStructure).toBe(UnitType.DefensePost);
    expect(turret.getAttribute("aria-pressed")).toBe("true");
    const tag = display.querySelector(".zf-build-tag")?.textContent ?? "";
    expect(tag).toContain("unit_type.defense_post");
    expect(tag).toContain("unit_display.level");
  });

  it("dims what can't be afforded and won't select it", async () => {
    const display = await mount(true, 10_000n);
    const mortar = display.querySelectorAll<HTMLButtonElement>("nav button")[2];
    expect(mortar.classList).toContain("zf-cannot-afford");
    mortar.click();
    expect(display.uiState.ghostStructure).toBeNull();
  });
});
