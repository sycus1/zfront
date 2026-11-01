// @vitest-environment jsdom
import {
  GRAPHICS_KEY,
  GRAPHICS_PRESETS_KEY,
  KEYBINDS_KEY,
  MAP_LAYERS_KEY,
  PERFORMANCE_OVERLAY_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
  getDefaultKeybinds,
} from "../src/client/UserSettings";

// UserSettings keeps a static in-memory cache and the active player id; reset
// both so each test reads fresh from the (cleared) localStorage as logged out.
function resetUserSettingsState() {
  localStorage.clear();
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

/** Record the `detail` of every change event for `key`. */
function listen(key: string): unknown[] {
  const seen: unknown[] = [];
  globalThis.addEventListener(`${USER_SETTINGS_CHANGED_EVENT}:${key}`, (e) =>
    seen.push((e as CustomEvent).detail),
  );
  return seen;
}

describe("UserSettings.resetGameplay", () => {
  beforeEach(resetUserSettingsState);

  it("puts every Gameplay-tab setting back to its default", () => {
    const s = new UserSettings();
    const fresh = {
      alertFrame: s.alertFrame(),
      cursorCostLabel: s.cursorCostLabel(),
      snapBuildPreview: s.snapBuildPreview(),
      leftClickOpensMenu: s.leftClickOpensMenu(),
      anonymousNames: s.anonymousNames(),
      lobbyIdVisibility: s.lobbyIdVisibility(),
      lobbyStartAlerts: s.lobbyStartAlerts(),
      goToPlayer: s.goToPlayer(),
      helpMessages: s.helpMessages(),
      attackingTroopsOverlay: s.attackingTroopsOverlay(),
      attackRatio: s.attackRatio(),
      attackRatioIncrement: s.attackRatioIncrement(),
    };

    s.toggleAlertFrame();
    s.toggleCursorCostLabel();
    s.toggleSnapBuildPreview();
    s.toggleLeftClickOpenMenu();
    s.toggleRandomName();
    s.toggleLobbyIdVisibility();
    s.setLobbyStartAlerts(!fresh.lobbyStartAlerts);
    s.toggleGoToPlayer();
    s.toggleHelpMessages();
    s.toggleAttackingTroopsOverlay();
    s.setAttackRatio(0.75);
    s.setAttackRatioIncrement(5);

    s.resetGameplay();

    expect({
      alertFrame: s.alertFrame(),
      cursorCostLabel: s.cursorCostLabel(),
      snapBuildPreview: s.snapBuildPreview(),
      leftClickOpensMenu: s.leftClickOpensMenu(),
      anonymousNames: s.anonymousNames(),
      lobbyIdVisibility: s.lobbyIdVisibility(),
      lobbyStartAlerts: s.lobbyStartAlerts(),
      goToPlayer: s.goToPlayer(),
      helpMessages: s.helpMessages(),
      attackingTroopsOverlay: s.attackingTroopsOverlay(),
      attackRatio: s.attackRatio(),
      attackRatioIncrement: s.attackRatioIncrement(),
    }).toEqual(fresh);
    expect(localStorage.getItem("settings.attackRatio")).toBeNull();
  });

  it("drops the legacy cost-label key that the default falls back to", () => {
    localStorage.setItem("settings.ghostPricePill", "false");
    const s = new UserSettings();
    expect(s.cursorCostLabel()).toBe(false);

    s.resetGameplay();

    expect(s.cursorCostLabel()).toBe(true);
  });

  it("announces the value each key now resolves to", () => {
    const s = new UserSettings();
    s.setAttackRatio(0.75);
    s.toggleRandomName();
    const ratio = listen("settings.attackRatio");
    const names = listen("settings.anonymousNames");

    s.resetGameplay();

    expect(ratio).toEqual([String(s.attackRatio())]);
    expect(names).toEqual(["false"]);
  });

  it("leaves the other tabs alone", () => {
    const s = new UserSettings();
    s.setHudOpacity(0.4);
    s.setAudioVolume("music", 0.1);
    s.setKeybinds({ buildCity: { value: "KeyZ", key: "z" } });

    s.resetGameplay();

    expect(s.hudOpacity()).toBe(0.4);
    expect(s.audioVolume("music")).toBe(0.1);
    expect(s.parsedUserKeybinds()).toEqual({
      buildCity: { value: "KeyZ", key: "z" },
    });
  });
});

describe("UserSettings.resetGraphics", () => {
  beforeEach(resetUserSettingsState);

  it("clears the overrides and the Graphics-tab switches", () => {
    const s = new UserSettings();
    s.setGraphicsOverrides({ mapOverlay: { territoryAlpha: 0.5 } });
    s.setHudOpacity(0.3);
    s.toggleEmojis();
    s.setPerformanceOverlay(true);
    s.toggleMapLayers();

    s.resetGraphics();

    expect(s.graphicsOverrides()).toEqual({});
    expect(s.hudOpacity()).toBe(1);
    expect(s.emojis()).toBe(true);
    expect(s.performanceOverlay()).toBe(false);
    expect(s.mapLayers()).toBe(true);
  });

  it("keeps the player's saved presets", () => {
    const s = new UserSettings();
    s.setGraphicsPresets({ Mine: { mapOverlay: { territoryAlpha: 0.2 } } });

    s.resetGraphics();

    expect(s.graphicsPresets()).toEqual({
      Mine: { mapOverlay: { territoryAlpha: 0.2 } },
    });
    expect(localStorage.getItem(GRAPHICS_PRESETS_KEY)).not.toBeNull();
  });

  it("announces the overlay as off and the overrides once, last", () => {
    const s = new UserSettings();
    s.setPerformanceOverlay(true);
    const overlay = listen(PERFORMANCE_OVERLAY_KEY);
    const graphics = listen(GRAPHICS_KEY);
    const layers = listen(MAP_LAYERS_KEY);

    s.resetGraphics();

    // PerformanceOverlay parses the detail as "true"/"false".
    expect(overlay).toEqual(["false"]);
    expect(graphics).toEqual(["{}"]);
    // Followed through GRAPHICS_KEY, so the layers are pushed only once.
    expect(layers).toEqual([]);
  });
});

describe("UserSettings.resetKeybinds", () => {
  beforeEach(resetUserSettingsState);

  it("puts every action back on its default key", () => {
    const s = new UserSettings();
    const defaults = getDefaultKeybinds(false);
    s.setKeybinds({
      buildCity: { value: "KeyZ", key: "z" },
      pauseGame: { value: "Null", key: "" },
    });
    expect(s.keybinds(false).buildCity).toBe("KeyZ");
    expect(s.keybinds(false).pauseGame).toBeUndefined();

    s.resetKeybinds();

    expect(s.parsedUserKeybinds()).toEqual({});
    expect(s.keybinds(false)).toEqual(defaults);
  });

  it("tells InputHandler to rebuild its table", () => {
    const s = new UserSettings();
    s.setKeybinds({ buildCity: { value: "KeyZ", key: "z" } });
    const seen = listen(KEYBINDS_KEY);

    s.resetKeybinds();

    expect(seen).toEqual(["{}"]);
  });
});
