import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../resources/lang/en.json";

import "../../src/client/components/Footer";
import "../../src/client/components/PlayPage";
import "../../src/client/GameModeSelector";
import "../../src/client/UsernameInput";
import {
  buildHorde,
  LIVE_FEED_HORDES,
  zombieAt,
} from "../../src/client/components/nightshift/LiveFeedBackdrop";
import { initNavigation } from "../../src/client/Navigation";

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };

async function settle(el: Element): Promise<void> {
  await (el as Mountable).updateComplete;
  for (const child of el.querySelectorAll("*")) {
    const c = child as Partial<Mountable>;
    if (c.updateComplete) await c.updateComplete;
  }
}

async function mount(tag: string): Promise<Mountable> {
  const el = document.createElement(tag) as Mountable;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
  localStorage.clear();
  window.currentPageId = "page-play";
});

describe("main menu", () => {
  it("shows the wordmark as an image with the hazard stripe under it", async () => {
    const page = await mount("play-page");
    const logo = page.querySelector<HTMLImageElement>("h1 img")!;
    // The logo is the SVG file, never the word typed in the stencil font.
    expect(logo.getAttribute("src")).toContain("zfront-wordmark.svg");
    expect(logo.alt).toBe("main.logo_alt");
    expect(page.querySelector("h1")!.textContent?.trim()).toBe("");
    const stripe = page.querySelector(".zf-hazard")!;
    expect(stripe.getAttribute("aria-hidden")).toBe("true");
  });

  it("puts the name field and the actions in the panel", async () => {
    const page = await mount("play-page");
    const panel = page.querySelector("section.zf-menu-panel")!;
    expect(panel.querySelector("username-input")).not.toBeNull();
    expect(panel.querySelector("game-mode-selector")).not.toBeNull();
  });

  it("has one primary action, PLAY SOLO, disabled while the name is invalid", async () => {
    const selector = await mount("game-mode-selector");
    const play = selector.querySelector<HTMLButtonElement>(".zf-btn-lg")!;
    expect(play.textContent).toContain("main.play_solo");
    expect(selector.querySelectorAll(".zf-btn-lg")).toHaveLength(1);
    expect(play.disabled).toBe(false);

    window.dispatchEvent(
      new CustomEvent("username-validity-change", {
        detail: { isValid: false },
      }),
    );
    await settle(selector);
    expect(play.disabled).toBe(true);
  });

  it("starts the tutorial from its link", async () => {
    const selector = await mount("game-mode-selector");
    const listener = vi.fn();
    document.addEventListener("start-tutorial", listener);
    const tutorial = Array.from(
      selector.querySelectorAll<HTMLButtonElement>(".zf-menu-link"),
    ).find((b) => b.textContent?.includes("main.tutorial"))!;
    tutorial.click();
    document.removeEventListener("start-tutorial", listener);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("routes Settings and Help to their inline pages", async () => {
    const selector = await mount("game-mode-selector");
    const pages = Array.from(
      selector.querySelectorAll<HTMLElement>(".nav-menu-item[data-page]"),
    ).map((b) => b.dataset.page);
    expect(pages).toEqual(["page-settings", "page-help"]);

    const target = document.createElement("div");
    target.id = "page-settings";
    target.className = "page-content hidden";
    document.body.appendChild(target);
    initNavigation();
    selector.querySelector<HTMLElement>('[data-page="page-settings"]')!.click();
    await vi.waitFor(() => expect(window.currentPageId).toBe("page-settings"));
    expect(target.classList.contains("hidden")).toBe(false);
    expect(document.body.classList.contains("page-open")).toBe(true);
  });
});

describe("footer", () => {
  // AGPL Section 7 (LICENSE): the notice stays visible on every menu screen.
  it("carries the OpenFront licence notice", async () => {
    const footer = await mount("page-footer");
    expect(footer.textContent).toContain("main.licence_notice");
    expect(en.main.licence_notice).toContain("© OpenFront and Contributors");
    expect(en.main.licence_notice).toContain("AGPL-3.0");
  });

  it("links the legal pages, troubleshooting and the source", async () => {
    const footer = await mount("page-footer");
    const hrefs = Array.from(footer.querySelectorAll("nav a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "/privacy-policy.html",
      "/terms-of-service.html",
      "https://github.com/sycus1/zfront",
    ]);
    expect(
      footer.querySelector('[data-page="page-troubleshooting"]'),
    ).not.toBeNull();
  });
});

describe("live feed horde", () => {
  it("is the same on every visit", () => {
    expect(buildHorde(LIVE_FEED_HORDES.desktop)).toEqual(
      buildHorde(LIVE_FEED_HORDES.desktop),
    );
    expect(buildHorde(LIVE_FEED_HORDES.desktop)).toHaveLength(160);
    expect(buildHorde(LIVE_FEED_HORDES.phone)).toHaveLength(110);
  });

  it("keeps zombies red and inside their routes", () => {
    const { west, south, river } = LIVE_FEED_HORDES.desktop;
    const xMin = Math.min(west.x0[0], south.x0[0], river.x0[0]);
    const xMax = Math.max(west.x1[1], south.x0[1], river.x1[1]);
    for (const z of buildHorde(LIVE_FEED_HORDES.desktop)) {
      expect(z.x0).toBeGreaterThanOrEqual(xMin);
      expect(z.x1).toBeLessThanOrEqual(xMax);
      // horde-500 to horde-300 and between: red dominant.
      expect(z.rgb[0]).toBeGreaterThan(z.rgb[1] * 2);
    }
  });

  it("walks from the edge to the kill point, then dies and fades", () => {
    const [z] = buildHorde(LIVE_FEED_HORDES.desktop);
    const start = zombieAt(z, 0);
    expect([start.x, start.y, start.alpha]).toEqual([z.x0, z.y0, 0]);
    const walking = zombieAt(z, 0.5);
    expect(walking.alpha).toBe(1);
    expect(walking.rgb).toEqual(z.rgb);
    const dead = zombieAt(z, 0.95);
    expect([dead.x, dead.y]).toEqual([z.x1, z.y1]);
    expect(dead.rgb).toEqual([0x59, 0x10, 0x09]);
    expect(zombieAt(z, 1).alpha).toBeCloseTo(0);
  });
});
