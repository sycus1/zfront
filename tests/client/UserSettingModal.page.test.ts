import { beforeEach, describe, expect, it } from "vitest";

import { modalRouter } from "../../src/client/ModalRouter";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";
import { UserSettings } from "../../src/client/UserSettings";
import { translateText } from "../../src/client/Utils";

type TestModal = UserSettingModal & {
  updateComplete: Promise<unknown>;
  activeTab: string;
};

async function mount(opts: { inline: boolean; tab: string }) {
  const el = document.createElement("user-setting") as TestModal;
  if (opts.inline) el.setAttribute("inline", "");
  el.id = opts.inline ? "page-settings" : "game-settings";
  document.body.appendChild(el);
  await el.updateComplete;
  el.open({ tab: opts.tab });
  await el.updateComplete;
  return el;
}

function resetButton(el: TestModal) {
  return el.querySelector<HTMLButtonElement>(`#${el.activeTab}-reset`);
}

function dialogButtons() {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      ".zf-dialog-actions button",
    ),
  ];
}

async function settle(el: TestModal) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe("user-setting Night Shift page", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    const statics = UserSettings as unknown as {
      cache: Map<string, string | null>;
      playerId: string | null;
    };
    statics.cache.clear();
    statics.playerId = null;
    location.hash = "";
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
  });

  it("draws the inline page as a full-width .zf-page with a stencil title", async () => {
    const el = await mount({ inline: true, tab: "gameplay" });
    expect(el.querySelector("section.zf-page")).not.toBeNull();
    expect(el.querySelector("o-modal")).toBeNull();
    expect(el.querySelector("h1.zf-page-title")?.textContent?.trim()).toBe(
      translateText("user_setting.title"),
    );
  });

  it("puts the in-game copy in an o-modal panel", async () => {
    const el = await mount({ inline: false, tab: "gameplay" });
    expect(el.querySelector("o-modal")).not.toBeNull();
    expect(el.querySelector("section.zf-page")).toBeNull();
  });

  it("selects a tab from the tab row and labels the panel by it", async () => {
    const el = await mount({ inline: true, tab: "gameplay" });
    const tab = el.querySelector<HTMLButtonElement>(
      '[role="tab"][data-key="audio"]',
    )!;
    tab.click();
    await el.updateComplete;

    expect(el.activeTab).toBe("audio");
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const panel = el.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  });

  it("moves between tabs with the arrow keys", async () => {
    const el = await mount({ inline: true, tab: "gameplay" });
    el.querySelector('[role="tablist"]')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await el.updateComplete;
    expect(el.activeTab).toBe("graphics");
  });

  it("resets Gameplay at once, without asking", async () => {
    const el = await mount({ inline: true, tab: "gameplay" });
    const s = new UserSettings();
    s.toggleRandomName();
    expect(s.anonymousNames()).toBe(true);

    resetButton(el)!.click();
    await settle(el);

    expect(dialogButtons()).toEqual([]);
    expect(s.anonymousNames()).toBe(false);
    const box = el.querySelector<HTMLInputElement>(
      "#anonymous-names-toggle input",
    )!;
    expect(box.checked).toBe(false);
  });

  it("asks before resetting Keybinds, and Cancel keeps them", async () => {
    const el = await mount({ inline: true, tab: "keybinds" });
    const s = new UserSettings();
    s.setKeybinds({ buildCity: { value: "KeyZ", key: "z" } });

    resetButton(el)!.click();
    await el.updateComplete;
    const [cancel] = dialogButtons();
    expect(cancel).toBeDefined();
    cancel.click();
    await settle(el);

    expect(s.parsedUserKeybinds()).toEqual({
      buildCity: { value: "KeyZ", key: "z" },
    });
  });

  it("resets Keybinds once confirmed", async () => {
    const el = await mount({ inline: true, tab: "keybinds" });
    const s = new UserSettings();
    s.setKeybinds({ buildCity: { value: "KeyZ", key: "z" } });

    resetButton(el)!.click();
    await el.updateComplete;
    const buttons = dialogButtons();
    buttons[buttons.length - 1].click();
    await settle(el);

    expect(s.parsedUserKeybinds()).toEqual({});
    expect(dialogButtons()).toEqual([]);
  });

  it("closes the prompt, not the page, on Escape", async () => {
    const el = await mount({ inline: true, tab: "keybinds" });
    resetButton(el)!.click();
    await el.updateComplete;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle(el);

    expect(dialogButtons()).toEqual([]);
    expect(el.isOpen()).toBe(true);
  });

  it("closes from DONE", async () => {
    const el = await mount({ inline: false, tab: "audio" });
    el.querySelector<HTMLButtonElement>("#settings-done")!.click();
    await el.updateComplete;
    expect(el.isOpen()).toBe(false);
  });
});

describe("user-setting key caps", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    const statics = UserSettings as unknown as {
      cache: Map<string, string | null>;
    };
    statics.cache.clear();
  });

  it("labels keys the way the boards do (CTRL, SPACE, NUM -)", async () => {
    const el = await mount({ inline: true, tab: "keybinds" });
    const cap = (action: string) =>
      el
        .querySelector(`setting-keybind[action="${action}"] [role="button"]`)
        ?.textContent?.trim();

    expect(cap("buildMenuModifier")).toBe("CTRL");
    expect(cap("toggleView")).toBe("SPACE");
    expect(cap("zoomOutNumpad")).toBe("NUM -");
    expect(cap("moveUpArrow")).toBe("↑");
    expect(cap("buildCity")).toBe("1");
  });
});
