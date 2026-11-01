import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, it, vi } from "vitest";
import "../../src/client/hud/layers/TutorialPanel";
import type { TutorialPanel } from "../../src/client/hud/layers/TutorialPanel";
import type { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

function firstTick(resumedFromSave: boolean, horde = false) {
  const myPlayer = vi.fn(() => null);
  const panel = document.createElement("tutorial-panel") as TutorialPanel;
  panel.game = {
    config: () => ({ isReplay: () => false, horde: () => horde }),
    myPlayer,
    resumedFromSave: () => resumedFromSave,
    setOwnSpawnRing: vi.fn(),
    setMarkedPlayers: vi.fn(),
  } as unknown as GameView;
  panel.eventBus = new EventBus();
  panel.userSettings = {
    tutorialDismissed: () => false,
  } as unknown as UserSettings;
  document.body.append(panel);
  panel.tick();
  return { myPlayer, panel };
}

describe("TutorialPanel", () => {
  it("runs for a player who hasn't dismissed it", () => {
    expect(firstTick(false).myPlayer).toHaveBeenCalled();
  });

  // Its first steps would hold the spawn ring on the player's territory
  // until they next attack.
  it("stays off in a game resumed from a save", () => {
    expect(firstTick(true).myPlayer).not.toHaveBeenCalled();
  });

  // zfront: the steps teach OpenFront, so a horde game says the zombie
  // tutorial is coming instead, and runs no steps.
  it("shows coming soon in a horde game, with no steps", async () => {
    const { myPlayer, panel } = firstTick(false, true);
    await panel.updateComplete;
    expect(myPlayer).not.toHaveBeenCalled();
    expect(panel.classList.contains("hidden")).toBe(false);
    const card = panel.querySelector("[data-tutorial-coming-soon]");
    expect(card?.textContent).toContain("tutorial.coming_soon");
    expect(panel.textContent).not.toContain("tutorial.step_counter");
    panel.remove();
  });
});
