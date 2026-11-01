import type { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  keyCapLabel,
  resolveKeybindLabel,
  translateText,
} from "../client/Utils";
// This type is erased at runtime; retain the import to register the setting.
// oxlint-disable-next-line import/no-duplicates -- Required custom-element registration.
import "./components/baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "./components/baseComponents/setting/SettingKeybind";
import "./components/baseComponents/setting/SettingNumber";
// This type is erased at runtime; retain the import to register the setting.
// oxlint-disable-next-line import/no-duplicates -- Required custom-element registration.
import "./components/baseComponents/setting/SettingSelect";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingToggle";
import { BaseModal } from "./components/BaseModal";
import "./components/GraphicsAdvancedSettings";
import type { GraphicsAdvancedSettings } from "./components/GraphicsAdvancedSettings";
import "./components/GraphicsPresetSelector";
import "./components/GraphicsPresetTools";
import { zfIcon } from "./components/nightshift/Icon";
import {
  zfButton,
  zfKeyCap,
  zfNote,
  zfPrimaryButton,
  zfTile,
} from "./components/nightshift/Primitives";
import { KeyboardLayoutController } from "./KeyboardLayout";
import { pushMapLayerState } from "./MapLayerSettings";
import { Platform } from "./Platform";
import type { AudioControls } from "./sound/CuePlayer";
import { audioControls, playCue } from "./sound/CuePlayer";
import type { CueCategory } from "./sound/Sounds";
import type { UIState } from "./UIState";
import {
  AudioCategory,
  getDefaultKeybinds,
  GRAPHICS_KEY,
  keysMayBeShared,
  MAP_LAYERS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "./UserSettings";

/** Mixer channels in the order the Audio tab shows them. */
const AUDIO_TAB_ORDER: readonly AudioCategory[] = [
  "master",
  "music",
  "effects",
  "alerts",
  "ambience",
  "interface",
];

/**
 * Rows that get a Test button. Master is tested by every other button and
 * music is already playing, so neither is previewable. Ambience is previewable
 * in principle but AudioMixer.previewCue("ambience") resolves without playing
 * — an ambience loop has no natural end — so a button there would do nothing.
 */
const PREVIEWABLE: readonly CueCategory[] = ["effects", "alerts", "interface"];

/**
 * Longest a Test button stays disabled waiting for its cue. Comfortably past
 * the longest preview cue; it only ever fires when a preview cannot settle.
 */
const PREVIEW_CEILING_MS = 10_000;

interface KeybindRow {
  action: string;
  /** Translation keys. */
  label: string;
  desc: string;
  descArgs?: (ctx: {
    increment: number;
    resetGfxKey: string;
  }) => Record<string, string | number>;
  /** A bare modifier (Shift, Ctrl…) is a valid key for this action. */
  allowModifiers?: boolean;
}

const row = (
  action: string,
  label: string,
  desc: string,
  extra: Partial<KeybindRow> = {},
): KeybindRow => ({ action, label, desc, ...extra });

/** The Keybinds tab: one Tile of KeyBindRows per group. */
const KEYBIND_GROUPS: readonly { title: string; rows: KeybindRow[] }[] = [
  {
    title: "user_setting.build_controls",
    rows: [
      row(
        "buildCity",
        "user_setting.build_city",
        "user_setting.build_city_desc",
      ),
      row(
        "buildFactory",
        "user_setting.build_factory",
        "user_setting.build_factory_desc",
      ),
      row(
        "buildPort",
        "user_setting.build_port",
        "user_setting.build_port_desc",
      ),
      row(
        "buildDefensePost",
        "user_setting.build_defense_post",
        "user_setting.build_defense_post_desc",
      ),
      row(
        "buildWall",
        "user_setting.build_wall",
        "user_setting.build_wall_desc",
      ),
      row(
        "buildOutpost",
        "user_setting.build_outpost",
        "user_setting.build_outpost_desc",
      ),
      row(
        "buildDepot",
        "user_setting.build_depot",
        "user_setting.build_depot_desc",
      ),
      row(
        "buildMine",
        "user_setting.build_mine",
        "user_setting.build_mine_desc",
      ),
      row(
        "buildNoiseBeacon",
        "user_setting.build_noise_beacon",
        "user_setting.build_noise_beacon_desc",
      ),
      row(
        "buildMissileSilo",
        "user_setting.build_missile_silo",
        "user_setting.build_missile_silo_desc",
      ),
      row(
        "buildSamLauncher",
        "user_setting.build_sam_launcher",
        "user_setting.build_sam_launcher_desc",
      ),
      row(
        "buildWarship",
        "user_setting.build_warship",
        "user_setting.build_warship_desc",
      ),
      row(
        "buildAtomBomb",
        "user_setting.build_atom_bomb",
        "user_setting.build_atom_bomb_desc",
      ),
      row(
        "buildHydrogenBomb",
        "user_setting.build_hydrogen_bomb",
        "user_setting.build_hydrogen_bomb_desc",
      ),
      row(
        "buildMIRV",
        "user_setting.build_mirv",
        "user_setting.build_mirv_desc",
      ),
    ],
  },
  {
    title: "user_setting.camera_movement",
    rows: [
      row(
        "centerCamera",
        "user_setting.center_camera",
        "user_setting.center_camera_desc",
      ),
      row("moveUp", "user_setting.move_up", "user_setting.move_up_desc"),
      row("moveUpArrow", "user_setting.move_up", "user_setting.move_up_desc"),
      row("moveLeft", "user_setting.move_left", "user_setting.move_left_desc"),
      row(
        "moveLeftArrow",
        "user_setting.move_left",
        "user_setting.move_left_desc",
      ),
      row("moveDown", "user_setting.move_down", "user_setting.move_down_desc"),
      row(
        "moveDownArrow",
        "user_setting.move_down",
        "user_setting.move_down_desc",
      ),
      row(
        "moveRight",
        "user_setting.move_right",
        "user_setting.move_right_desc",
      ),
      row(
        "moveRightArrow",
        "user_setting.move_right",
        "user_setting.move_right_desc",
      ),
    ],
  },
  {
    title: "user_setting.zoom_controls",
    rows: [
      row("zoomOut", "user_setting.zoom_out", "user_setting.zoom_out_desc"),
      row(
        "zoomOutMinus",
        "user_setting.zoom_out",
        "user_setting.zoom_out_desc",
      ),
      row(
        "zoomOutNumpad",
        "user_setting.zoom_out",
        "user_setting.zoom_out_desc",
      ),
      row("zoomIn", "user_setting.zoom_in", "user_setting.zoom_in_desc"),
      row("zoomInEqual", "user_setting.zoom_in", "user_setting.zoom_in_desc"),
      row("zoomInNumpad", "user_setting.zoom_in", "user_setting.zoom_in_desc"),
    ],
  },
  {
    title: "user_setting.menu_shortcuts",
    rows: [
      row(
        "buildMenuModifier",
        "user_setting.build_menu_modifier",
        "user_setting.build_menu_modifier_desc",
        {
          allowModifiers: true,
        },
      ),
      row(
        "emojiMenuModifier",
        "user_setting.emoji_menu_modifier",
        "user_setting.emoji_menu_modifier_desc",
        {
          allowModifiers: true,
        },
      ),
      row(
        "boxSelectWarships",
        "user_setting.box_select_warships",
        "user_setting.box_select_warships_desc",
        {
          allowModifiers: true,
        },
      ),
      row(
        "selectAllWarships",
        "user_setting.select_all_warships",
        "user_setting.select_all_warships_desc",
      ),
      row(
        "pauseGame",
        "user_setting.pause_game",
        "user_setting.pause_game_desc",
      ),
      row(
        "gameSpeedUp",
        "user_setting.game_speed_up",
        "user_setting.game_speed_up_desc",
      ),
      row(
        "gameSpeedDown",
        "user_setting.game_speed_down",
        "user_setting.game_speed_down_desc",
      ),
    ],
  },
  {
    title: "user_setting.view_options",
    rows: [
      row(
        "toggleView",
        "user_setting.toggle_view",
        "user_setting.toggle_view_desc",
      ),
      {
        action: "coordinateGrid",
        label: "user_setting.coordinate_grid_label",
        desc: "user_setting.coordinate_grid_desc",
      },
      {
        action: "altKey",
        label: "user_setting.graphics_refresh_modifier",
        desc: "user_setting.graphics_refresh_modifier_desc",
        descArgs: ({ resetGfxKey }) => ({ key: resetGfxKey }),
        allowModifiers: true,
      },
      {
        action: "resetGfx",
        label: "help_modal.action_reset_gfx",
        desc: "user_setting.reset_gfx_desc",
      },
    ],
  },
  {
    title: "user_setting.attack_ratio_controls",
    rows: [
      row(
        "attackRatioDown",
        "user_setting.attack_ratio_down",
        "user_setting.attack_ratio_down_desc",
        {
          descArgs: ({ increment }) => ({ amount: increment }),
        },
      ),
      row(
        "attackRatioUp",
        "user_setting.attack_ratio_up",
        "user_setting.attack_ratio_up_desc",
        {
          descArgs: ({ increment }) => ({ amount: increment }),
        },
      ),
    ],
  },
  {
    title: "user_setting.attack_keybinds",
    rows: [
      row(
        "boatAttack",
        "user_setting.boat_attack",
        "user_setting.boat_attack_desc",
      ),
      row(
        "groundAttack",
        "user_setting.ground_attack",
        "user_setting.ground_attack_desc",
      ),
      row(
        "retaliateAttack",
        "user_setting.retaliate_attack",
        "user_setting.retaliate_attack_desc",
      ),
      row(
        "swapDirection",
        "user_setting.swap_direction",
        "user_setting.swap_direction_desc",
      ),
    ],
  },
  {
    title: "user_setting.ally_keybinds",
    rows: [
      row(
        "targetPlayer",
        "user_setting.target_player",
        "user_setting.target_player_desc",
      ),
      row(
        "emojiMenu",
        "user_setting.emoji_menu",
        "user_setting.emoji_menu_desc",
      ),
      row(
        "quickChat",
        "user_setting.quick_chat",
        "user_setting.quick_chat_desc",
      ),
    ],
  },
];

@customElement("user-setting")
export class UserSettingModal extends BaseModal {
  private keyboardLayout = new KeyboardLayoutController(this);
  private currentUiScale: number | undefined;
  protected routerName: string | undefined = "settings";

  /**
   * Also set on the in-game instance by GameRenderer. The HUD's own attack
   * ratio slider is session-only — it never writes UserSettings — so in a
   * running game the live ratio is the one in UIState, not the stored one.
   */
  public uiState?: UIState;

  // ---- Graphics: the running game's map layers ----
  //
  // Also set on the in-game instance by GameRenderer. Every other graphics
  // option is stored under one settings key that ClientGameRunner watches, so
  // a running game follows it with no reference here; map layers are the
  // exception. Their control set comes from the current map, and the renderer
  // does not re-read their visibility or alpha from settings after startup —
  // so the layer rows exist only where a game hands them over, and every
  // change to the graphics key re-pushes them through these callbacks.

  /** Map layers for the current game. Empty on the page instance. */
  public mapLayers: MapLayer[] = [];

  /** Callback to toggle layer visibility on the renderer. */
  public onLayerVisibilityChange:
    | ((layerId: string, visible: boolean) => void)
    | null = null;

  /** Callback to set layer alpha on the renderer. */
  public onLayerAlphaChange: ((layerId: string, alpha: number) => void) | null =
    null;

  private userSettings: UserSettings = new UserSettings();
  private readonly defaultKeybinds = getDefaultKeybinds(Platform.isMac);

  // Optional "return to where you came from" callback, supplied by the caller
  // of open() and invoked once on close. The in-game menu uses it to reappear.
  private onReturn?: () => void;

  @state() private keySequence: string[] = [];
  @state() private graphicsAdvancedOpen = false;
  @state() private showEasterEggSettings = false;

  @state() private userKeybinds: Record<
    string,
    { value: string; key: string }
  > = {};

  private lastHasKeyboard = Platform.hasKeyboard;

  private handleKeyboardDetection = () => {
    if (Platform.hasKeyboard && !this.lastHasKeyboard) {
      this.lastHasKeyboard = true;
      this.requestUpdate();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    // Only the inline page instance owns the #modal=settings URL state. The
    // in-game instance must not touch the hash: Main's popstate handler treats
    // a hash change during a match as a request to leave the game.
    if (!this.inline) {
      this.routerName = undefined;
    }
    this.loadKeybindsFromStorage();
    this.lastHasKeyboard = Platform.hasKeyboard;
    window.addEventListener("keydown", this.handleKeyboardDetection);
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      this.onGraphicsChanged,
    );
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${MAP_LAYERS_KEY}`,
      this.onGraphicsChanged,
    );
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyboardDetection);
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      this.onGraphicsChanged,
    );
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${MAP_LAYERS_KEY}`,
      this.onGraphicsChanged,
    );
    window.removeEventListener("keydown", this.handleEasterEggKey);
    super.disconnectedCallback();
  }

  /**
   * The single place layer state reaches the renderer.
   *
   * It belongs here rather than in the advanced graphics body because that
   * body only exists while the Advanced fold is open, and a preset picked or a
   * configuration imported with the fold collapsed changes layers just the
   * same. Off a game the callbacks are null and this is a no-op.
   */
  private readonly onGraphicsChanged = () => {
    pushMapLayerState(
      this.userSettings,
      this.mapLayers,
      this.onLayerVisibilityChange,
      this.onLayerAlphaChange,
    );
  };

  private loadKeybindsFromStorage() {
    const parsed = this.userSettings.parsedUserKeybinds();
    if (Object.keys(parsed).length === 0) {
      this.userKeybinds = {};
      return;
    }

    const validated: Record<string, { value: string; key: string }> = {};

    for (const [action, entry] of Object.entries(parsed)) {
      if (typeof entry === "string") {
        validated[action] = { value: entry, key: entry };
      } else if (
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry)
      ) {
        const rawValue = (entry as any).value ?? "Null";
        const value = Array.isArray(rawValue)
          ? rawValue.find((v) => typeof v === "string")
          : rawValue;

        const rawKey = (entry as any).key ?? value;
        const key = Array.isArray(rawKey)
          ? rawKey.find((v) => typeof v === "string")
          : rawKey;

        if (typeof value === "string" && typeof key === "string") {
          validated[action] = { value, key };
        }
      }
    }

    this.userKeybinds = validated;
  }

  private handleKeybindChange(
    e: CustomEvent<{
      action: string;
      value: string;
      key: string;
      prevValue?: string;
    }>,
  ) {
    const { action, value, key, prevValue } = e.detail;

    const activeKeybinds = { ...this.defaultKeybinds };
    for (const [k, v] of Object.entries(this.userKeybinds)) {
      const normalizedValue = v.value;
      if (normalizedValue === "Null") {
        delete activeKeybinds[k];
      } else {
        activeKeybinds[k] = normalizedValue;
      }
    }

    const values = Object.entries(activeKeybinds)
      .filter(([k]) => k !== action && !keysMayBeShared(action, k))
      .map(([, v]) => v);

    // Allow specific key pairs to share physical modifier keys without reporting conflict
    const ALLOWED_SHARED_MODIFIERS: Array<{
      actions: [string, string];
      keyPrefix: string;
    }> = [
      { actions: ["emojiMenuModifier", "altKey"], keyPrefix: "Alt" },
      { actions: ["boxSelectWarships", "shiftKey"], keyPrefix: "Shift" },
    ];

    const isAllowedSharedModifier = ALLOWED_SHARED_MODIFIERS.some(
      ({ actions: [a1, a2], keyPrefix }) =>
        ((action === a1 && activeKeybinds[a2] === value) ||
          (action === a2 && activeKeybinds[a1] === value)) &&
        (value === `${keyPrefix}Left` || value === `${keyPrefix}Right`),
    );

    if (
      values.includes(value) &&
      value !== "Null" &&
      !isAllowedSharedModifier
    ) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: html`
              <span class="inline-flex items-center gap-2 text-zf-horde-300">
                ${zfIcon("warning", 22, 2.8)}
                <span>
                  ${(() => {
                    const placeholder = "__KEY__";
                    const message = translateText(
                      "user_setting.keybind_conflict_error",
                      { key: placeholder },
                    );
                    const [prefix, suffix] = message.split(placeholder);
                    return html`${prefix}${zfKeyCap(
                      keyCapLabel(key || value, Platform.isMac),
                    )}${suffix || ""}`;
                  })()}
                </span>
              </span>
            `,
            color: "red",
            duration: 3000,
          },
        }),
      );

      const element = this.renderRoot.querySelector<SettingKeybind>(
        `setting-keybind[action="${action}"]`,
      );
      if (element) {
        element.value = prevValue ?? this.defaultKeybinds[action] ?? "";
        element.requestUpdate();
      }
      return;
    }

    this.userKeybinds = {
      ...this.userKeybinds,
      [action]: { value: value, key: key },
    };
    this.userSettings.setKeybinds(this.userKeybinds);
  }

  private getKeyValue(action: string): string | undefined {
    const entry = this.userKeybinds[action];
    if (!entry) return undefined;
    const normalizedValue = entry.value;
    if (normalizedValue === "Null") return "";
    return normalizedValue || undefined;
  }

  private getKeyChar(action: string): string {
    const entry = this.userKeybinds[action];
    const defaultCode = this.defaultKeybinds[action] || "";
    return resolveKeybindLabel(entry, defaultCode, this.keyboardLayout.map);
  }

  private handleEasterEggKey = (e: KeyboardEvent) => {
    if (!this.isModalOpen || this.showEasterEggSettings) return;

    // Validate that the event target is inside this component
    const target = e.target;
    if (!(target instanceof Node) || !this.contains(target)) {
      return;
    }

    const key = e.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-4);
    this.keySequence = nextSequence;

    if (nextSequence.join("") === "evan") {
      this.triggerEasterEgg();
      this.keySequence = [];
    }
  };

  private triggerEasterEgg() {
    console.log("🪺 Setting~ unlocked by EVAN combo!");
    this.showEasterEggSettings = true;
    const popup = document.createElement("div");
    popup.className =
      "zf-frame fixed top-10 left-1/2 px-6 py-4 font-zf-display font-black text-3xl uppercase text-zf-signal-400 [--zf-fill:var(--color-zf-ink-900)] [--zf-border:var(--color-zf-signal-400)] animate-fadePop z-[9999]";
    popup.setAttribute("role", "status");
    popup.textContent = translateText("user_setting.easter_found");
    document.body.appendChild(popup);

    setTimeout(() => {
      popup.remove();
    }, 5000);
  }

  private toggleEmojis() {
    this.userSettings.toggleEmojis();

    console.log("🤡 Emojis:", this.userSettings.emojis() ? "ON" : "OFF");
  }

  private toggleAlertFrame() {
    this.userSettings.toggleAlertFrame();

    console.log(
      "🚨 Alert frame:",
      this.userSettings.alertFrame() ? "ON" : "OFF",
    );
  }

  private toggleCursorCostLabel() {
    this.userSettings.toggleCursorCostLabel();

    console.log(
      "💰 Cursor build cost:",
      this.userSettings.cursorCostLabel() ? "ON" : "OFF",
    );
  }

  private toggleSnapBuildPreview() {
    this.userSettings.toggleSnapBuildPreview();

    console.log(
      "🧲 Snap build preview:",
      this.userSettings.snapBuildPreview() ? "ON" : "OFF",
    );
  }

  private toggleAnonymousNames() {
    this.userSettings.toggleRandomName();

    console.log(
      "🙈 Anonymous Names:",
      this.userSettings.anonymousNames() ? "ON" : "OFF",
    );
  }

  private toggleLobbyIdVisibility() {
    this.userSettings.toggleLobbyIdVisibility();
    console.log(
      "👁️ Hidden Lobby IDs:",
      !this.userSettings.lobbyIdVisibility() ? "ON" : "OFF",
    );
  }

  private toggleLobbyStartAlerts(e: Event) {
    const enabled = (e.target as HTMLInputElement).checked;
    this.userSettings.setLobbyStartAlerts(enabled);

    // A permission prompt must originate from a user gesture. Persist the
    // choice regardless of the result: desktop notifications are optional,
    // and the lobby-start chime still works when permission is denied.
    if (
      enabled &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      try {
        void Notification.requestPermission().catch((error) => {
          console.warn(
            "Failed to request game-start notification permission",
            error,
          );
        });
      } catch (error) {
        console.warn(
          "Failed to request game-start notification permission",
          error,
        );
      }
    }
    this.requestUpdate();
  }

  private toggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
    console.log(
      "🖱️ Left Click Opens Menu:",
      this.userSettings.leftClickOpensMenu() ? "ON" : "OFF",
    );

    this.requestUpdate();
  }

  /** The ratio the player is actually attacking with right now. */
  private currentAttackRatio(): number {
    return this.uiState?.attackRatio ?? this.userSettings.attackRatio();
  }

  private sliderAttackRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      // ControlPanel listens for this and updates both its cached ratio and
      // UIState, so the running game follows the slider.
      this.userSettings.setAttackRatio(ratio);
      this.requestUpdate();
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private changeAttackRatioIncrement(
    e: CustomEvent<{ value: number | string }>,
  ) {
    const rawValue = e.detail?.value;
    const value =
      typeof rawValue === "number" ? rawValue : parseInt(String(rawValue), 10);
    if (!Number.isFinite(value)) {
      console.warn("Select event missing detail.value", e);
      return;
    }
    this.userSettings.setAttackRatioIncrement(Math.round(value));
    this.requestUpdate();
  }

  private toggleGoToPlayer() {
    this.userSettings.toggleGoToPlayer();

    console.log(
      "🔍 Go to player:",
      this.userSettings.goToPlayer() ? "ON" : "OFF",
    );
  }

  private togglePerformanceOverlay() {
    this.userSettings.togglePerformanceOverlay();
  }

  private toggleMapLayers() {
    this.userSettings.toggleMapLayers();
  }

  private toggleHelpMessages() {
    this.userSettings.toggleHelpMessages();

    console.log(
      "Help messages:",
      this.userSettings.helpMessages() ? "ON" : "OFF",
    );
  }

  private toggleAttackingTroopsOverlay() {
    this.userSettings.toggleAttackingTroopsOverlay();

    console.log(
      "Attacking troops overlay:",
      this.userSettings.attackingTroopsOverlay() ? "ON" : "OFF",
    );
  }

  // A slider handler writes the setting and stops. AudioMixer follows
  // USER_SETTINGS_CHANGED_EVENT for that key, which reaches the menu theme on
  // this page and a running game's music alike — no volume event, no bus, and
  // so no second EventBus for the home page to be missing.
  private sliderAudio(
    category: AudioCategory,
    e: CustomEvent<{ value: number }>,
  ) {
    const value = e.detail?.value;
    if (typeof value !== "number") {
      console.warn("Slider event missing detail.value", e);
      return;
    }
    this.userSettings.setAudioVolume(category, value / 100);
    this.playSliderTick();
    this.requestUpdate();
  }

  private resetAudio() {
    // No confirmation: nothing is destroyed that a player cannot put back by
    // moving a slider, and the result is audible immediately.
    this.userSettings.resetAudio();
    this.requestUpdate();
  }

  private toggleMuteOnBlur(e: Event) {
    this.userSettings.setMuteOnBlur((e.target as HTMLInputElement).checked);
    // Re-render so the dependent "keep alerts audible" row follows.
    this.requestUpdate();
  }

  private toggleAlertsWhenUnfocused(e: Event) {
    this.userSettings.setAlertsWhenUnfocused(
      (e.target as HTMLInputElement).checked,
    );
    this.requestUpdate();
  }

  // @change fires throughout a drag; rate-limit the tick so dragging sounds
  // like a ratchet rather than a buzz.
  private lastSliderTickMs = 0;

  /**
   * Only ever reached from a slider's `change` handler, which `setting-slider`
   * dispatches from its `@input` — a user drag. Setting `.value`
   * programmatically never routes through here, so the tick cannot fire on a
   * re-render. Via CuePlayer so this modal does not drag howler into every
   * test that mounts it.
   */
  private playSliderTick() {
    const now = Date.now();
    if (now - this.lastSliderTickMs < 150) return;
    this.lastSliderTickMs = now;
    playCue("slider");
  }

  /**
   * Channels with a preview cue in flight. A button stays disabled until its
   * own cue finishes, so a player cannot stack copies of it.
   */
  @state() private previewing: ReadonlySet<CueCategory> = new Set();

  private async playTestCue(category: CueCategory) {
    const controls = audioControls();
    if (controls === null || this.previewing.has(category)) return;
    this.previewing = new Set([...this.previewing, category]);
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    try {
      // A cue whose asset fails to load or play settles neither `end` nor
      // `stop` in Howler, so previewCue would never resolve and the button
      // would stay disabled for the life of the page. Race a ceiling so the
      // worst case is one dead press, not a permanently dead button.
      await Promise.race([
        controls.previewCue(category),
        new Promise<void>((resolve) => {
          ceiling = setTimeout(resolve, PREVIEW_CEILING_MS);
        }),
      ]);
    } catch (error) {
      // The cue is a convenience; a failed preview must not break the tab.
      console.warn("Failed to play audio preview", error);
    } finally {
      if (ceiling !== undefined) clearTimeout(ceiling);
      const remaining = new Set(this.previewing);
      remaining.delete(category);
      this.previewing = remaining;
    }
  }

  private renderTestButton(controls: AudioControls, category: CueCategory) {
    // isAudible gates on master before the channel, so on a fresh web install
    // — master 0, channels at their defaults — every button would otherwise
    // read "turn this category up", blaming a slider that is already up. The
    // master row has no Test button, so that hint cannot even be followed.
    const masterMuted = !controls.isAudible("master");
    const muted = masterMuted || !controls.isAudible(category);
    const hint = masterMuted
      ? "user_setting.audio_test_master_muted"
      : "user_setting.audio_test_muted";
    const pending = this.previewing.has(category);
    return zfButton({
      id: `audio-${category}-test`,
      label: translateText("user_setting.audio_test"),
      size: "sm",
      disabled: muted || pending,
      title: muted ? translateText(hint) : "",
      onClick: () => void this.playTestCue(category),
    });
  }

  private renderVolumeSlider(category: AudioCategory) {
    const controls = audioControls();
    return html`
      <div class="zf-volume-row">
        <setting-slider
          compact
          label="${translateText(`user_setting.audio_${category}`)}"
          description="${translateText(`user_setting.audio_${category}_desc`)}"
          id="audio-${category}-slider"
          min="0"
          max="100"
          unit=""
          .value=${Math.round(this.userSettings.audioVolume(category) * 100)}
          @change=${(e: CustomEvent<{ value: number }>) =>
            this.sliderAudio(category, e)}
        ></setting-slider>
        ${
          controls !== null && PREVIEWABLE.includes(category as CueCategory)
            ? this.renderTestButton(controls, category as CueCategory)
            : nothing
        }
      </div>
    `;
  }

  private renderAudioSettings() {
    const muteOnBlur = this.userSettings.muteOnBlur();
    return html`
      ${zfTile({
        title: translateText("zf_settings.tile_volume"),
        body: html`<div class="zf-volume-grid">
          ${AUDIO_TAB_ORDER.map((category) => this.renderVolumeSlider(category))}
        </div>`,
      })}
      ${zfTile({
        title: translateText("zf_settings.tile_unfocused"),
        body: html`<div class="zf-chips">
          <setting-toggle
            chip
            label="${translateText("user_setting.audio_mute_on_blur")}"
            description="${translateText("user_setting.audio_mute_on_blur_desc")}"
            id="audio-mute-on-blur-toggle"
            .checked=${muteOnBlur}
            @change=${this.toggleMuteOnBlur}
          ></setting-toggle>
          <!-- Dependent on the switch before it: meaningless when nothing is
               muted. -->
          <setting-toggle
            chip
            label="${translateText("user_setting.audio_alerts_when_unfocused")}"
            description="${translateText(
              "user_setting.audio_alerts_when_unfocused_desc",
            )}"
            id="audio-alerts-when-unfocused-toggle"
            .checked=${this.userSettings.alertsWhenUnfocused()}
            ?disabled=${!muteOnBlur}
            @change=${this.toggleAlertsWhenUnfocused}
          ></setting-toggle>
        </div>`,
      })}
    `;
  }

  protected modalConfig() {
    return {
      tabs: [
        { key: "gameplay", label: translateText("user_setting.tab_gameplay") },
        { key: "graphics", label: translateText("user_setting.tab_graphics") },
        { key: "audio", label: translateText("user_setting.tab_audio") },
        // Keybinds is about having keys. A touch device has none, so the tab
        // is a list of rebind controls the player can neither use nor trigger.
        //
        // Platform.isTouch tests the PRIMARY pointer (`pointer: coarse`), not
        // the viewport, which is the distinction that matters here: a laptop
        // with a touchscreen and a mouse keeps the tab, and a tablet loses it
        // at any width. A CSS breakpoint would get both backwards.
        //
        // Removed from tabs[] rather than hidden, so BaseModal -- which
        // validates a requested tab against this list -- lands
        // open({ tab: "keybinds" }) on Gameplay instead of selecting a tab
        // with nothing behind it.
        ...(Platform.isTouch && !Platform.hasKeyboard
          ? []
          : [
              {
                key: "keybinds",
                label: translateText("user_setting.tab_keybinds"),
              },
            ]),
      ],
    };
  }

  protected pageTitle(): string {
    return translateText("user_setting.title");
  }

  protected renderBody(tab: string) {
    switch (tab) {
      case "keybinds":
        return this.renderKeybindSettings();
      case "audio":
        return this.renderAudioSettings();
      case "graphics":
        return this.renderGraphicsSettings();
      default:
        return this.renderGameplaySettings();
    }
  }

  /**
   * The end of the page: "Reset <tab> to Defaults" (danger, so red), then the
   * yellow strip with DONE. Settings save as they change, so DONE only leaves.
   */
  protected renderActions() {
    const tab = this.activeTab || "gameplay";
    const tabLabel =
      this.modalConfig().tabs.find((t) => t.key === tab)?.label ?? "";
    return html`
      <div class="zf-reset-row">
        ${zfButton({
          id: `${tab}-reset`,
          label: translateText("zf_settings.reset_tab", { tab: tabLabel }),
          variant: "danger",
          icon: "reset",
          onClick: () => void this.resetTab(tab, tabLabel),
        })}
      </div>
      <div
        class="zf-strip zf-strip-compact zf-settings-strip zf-frame zf-frame-lg"
      >
        <div class="zf-strip-items">
          <span class="zf-strip-hint">
            ${translateText("zf_settings.saved_hint")}
          </span>
        </div>
        <div class="zf-strip-action">
          ${zfPrimaryButton({
            id: "settings-done",
            label: translateText("zf_settings.done"),
            icon: "check",
            onClick: () => this.close(),
          })}
        </div>
      </div>
    `;
  }

  /**
   * Back to the defaults for one tab. Audio and Gameplay reset at once:
   * nothing is lost that a player cannot put back with a switch or a slider.
   * Graphics and Keybinds ask first, since a tuned look or a remapped
   * keyboard takes a while to rebuild.
   */
  private async resetTab(tab: string, tabLabel: string) {
    const ask = (messageKey: string) =>
      this.askConfirm({
        heading: translateText("zf_settings.reset_confirm_heading", {
          tab: tabLabel,
        }),
        message: translateText(messageKey),
        confirmText: translateText("zf_settings.reset_confirm"),
        variant: "danger",
      });
    switch (tab) {
      case "audio":
        this.resetAudio();
        return;
      case "gameplay":
        this.userSettings.resetGameplay();
        break;
      case "graphics":
        if (!(await ask("zf_settings.reset_graphics_confirm"))) return;
        this.userSettings.resetGraphics();
        document.documentElement.style.setProperty(
          "--hud-opacity",
          String(this.userSettings.hudOpacity()),
        );
        break;
      case "keybinds":
        if (!(await ask("zf_settings.reset_keybinds_confirm"))) return;
        this.userSettings.resetKeybinds();
        this.loadKeybindsFromStorage();
        break;
      default:
        return;
    }
    this.requestUpdate();
  }

  protected updated(): void {
    this.syncGraphicsLayerWiring();
  }

  /**
   * Hand the advanced graphics body the current game's layers, so it can draw
   * a row per layer. It only exists while the Graphics tab is open and
   * Advanced is expanded, so this runs on every update rather than once: the
   * element is created and destroyed as the player moves between tabs.
   */
  private syncGraphicsLayerWiring(): void {
    const advanced = this.querySelector<GraphicsAdvancedSettings>(
      "graphics-advanced-settings",
    );
    if (advanced === null) return;
    advanced.mapLayers = this.mapLayers;
  }

  private toggleGraphicsAdvanced() {
    this.graphicsAdvancedOpen = !this.graphicsAdvancedOpen;
  }

  protected onClose(): void {
    window.removeEventListener("keydown", this.handleEasterEggKey);
    // Fire once: a caller that reopens us on return would otherwise inherit
    // the previous caller's callback.
    const onReturn = this.onReturn;
    this.onReturn = undefined;
    onReturn?.();
  }

  private keybindRow(row: KeybindRow) {
    return html`<setting-keybind
      action=${row.action}
      .allowModifiers=${row.allowModifiers ?? false}
      label=${translateText(row.label)}
      description=${translateText(
        row.desc,
        row.descArgs?.({
          increment: this.userSettings.attackRatioIncrement(),
          resetGfxKey: this.getKeyChar("resetGfx").toUpperCase(),
        }),
      )}
      .defaultKey=${this.defaultKeybinds[row.action]}
      .value=${this.getKeyValue(row.action)}
      .display=${this.getKeyChar(row.action)}
      @change=${this.handleKeybindChange}
    ></setting-keybind>`;
  }

  private renderKeybindSettings() {
    return html`
      ${zfNote(translateText("user_setting.keybinds_hint"), "keyboard")}
      <div class="zf-panel-grid zf-keybind-grid">
        ${KEYBIND_GROUPS.map((group) =>
          zfTile({
            title: translateText(group.title),
            className: "zf-tile-rows",
            body: html`${group.rows.map((row) => this.keybindRow(row))}`,
          }),
        )}
      </div>
    `;
  }

  /**
   * Purely visual switches — how the map and HUD are drawn. Anything that
   * changes how the game is played, or what the game tells you, belongs in
   * renderGameplaySettings() instead.
   */
  private renderGraphicsSettings() {
    return html`
      ${zfTile({
        title: translateText("user_setting.graphics_preset_label"),
        body: html`<p class="zf-setting-desc" style="margin: 0">
            ${translateText("user_setting.graphics_preset_desc")}
          </p>
          <graphics-preset-selector></graphics-preset-selector>`,
      })}
      <div class="zf-panel-grid">
        ${zfTile({
          title: translateText("zf_settings.tile_effects"),
          body: html`<div class="zf-chips">
            <setting-toggle
              chip
              label="${translateText("user_setting.emojis_label")}"
              description="${translateText("user_setting.emojis_desc")}"
              id="emoji-toggle"
              .checked=${this.userSettings.emojis()}
              @change=${this.toggleEmojis}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.performance_overlay_label")}"
              description="${translateText(
                "user_setting.performance_overlay_desc",
              )}"
              id="performance-overlay-toggle"
              .checked=${this.userSettings.performanceOverlay()}
              @change=${this.togglePerformanceOverlay}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.map_layers_label")}"
              description="${translateText("user_setting.map_layers_desc")}"
              id="map-layers-toggle"
              .checked=${this.userSettings.mapLayers()}
              @change=${this.toggleMapLayers}
            ></setting-toggle>
          </div>`,
        })}
        ${zfTile({
          title: translateText("zf_settings.tile_hud"),
          body: html`<setting-slider
            compact
            label=${translateText("user_setting.hud_opacity_label")}
            description=${translateText("user_setting.hud_opacity_desc")}
            id="hud-opacity-slider"
            .value=${this.userSettings.hudOpacity() * 100}
            @change=${(e: CustomEvent<{ value: number }>) => {
              this.userSettings.setHudOpacity(e.detail.value / 100);
              document.documentElement.style.setProperty(
                "--hud-opacity",
                String(this.userSettings.hudOpacity()),
              );
            }}
          ></setting-slider>`,
        })}
        ${zfTile({
          // Save / share the whole configuration. Not inside Advanced: a
          // player who never expands the fold should still find it.
          title: translateText("zf_settings.tile_save_share"),
          body: html`<graphics-preset-tools></graphics-preset-tools>`,
        })}
      </div>
      ${zfTile({
        title: translateText("graphics_setting.advanced_label"),
        body: html`
          <setting-toggle
            chip
            label="${translateText("graphics_setting.advanced_desc")}"
            id="graphics-advanced-toggle"
            .checked=${this.graphicsAdvancedOpen}
            @change=${this.toggleGraphicsAdvanced}
          ></setting-toggle>
          ${
            this.graphicsAdvancedOpen
              ? html`<graphics-advanced-settings></graphics-advanced-settings>`
              : nothing
          }
        `,
      })}
    `;
  }

  private renderGameplaySettings() {
    return html`
      <div class="zf-panel-grid">
        ${zfTile({
          title: translateText("zf_settings.tile_interface"),
          body: html`<div class="zf-chips">
            <setting-toggle
              chip
              label="${translateText("user_setting.help_messages_label")}"
              description="${translateText("user_setting.help_messages_desc")}"
              id="help-messages-toggle"
              .checked=${this.userSettings.helpMessages()}
              @change=${this.toggleHelpMessages}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.left_click_label")}"
              description="${translateText("user_setting.left_click_desc")}"
              id="left-click-toggle"
              .checked=${this.userSettings.leftClickOpensMenu()}
              @change=${this.toggleLeftClickOpensMenu}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.go_to_player_label")}"
              description="${translateText("user_setting.go_to_player_desc")}"
              id="go-to-player-toggle"
              .checked=${this.userSettings.goToPlayer()}
              @change=${this.toggleGoToPlayer}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText(
                "user_setting.attacking_troops_overlay_label",
              )}"
              description="${translateText(
                "user_setting.attacking_troops_overlay_desc",
              )}"
              id="attacking-troops-overlay-toggle"
              .checked=${this.userSettings.attackingTroopsOverlay()}
              @change=${this.toggleAttackingTroopsOverlay}
            ></setting-toggle>
          </div>`,
        })}
        ${zfTile({
          title: translateText("zf_settings.tile_building"),
          body: html`<div class="zf-chips">
            <setting-toggle
              chip
              label="${translateText("user_setting.snap_build_preview_label")}"
              description="${translateText(
                "user_setting.snap_build_preview_desc",
              )}"
              id="snap-build-preview-toggle"
              .checked=${this.userSettings.snapBuildPreview()}
              @change=${this.toggleSnapBuildPreview}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.cursor_cost_label_label")}"
              description="${translateText(
                "user_setting.cursor_cost_label_desc",
              )}"
              id="cursor_cost_label-toggle"
              .checked=${this.userSettings.cursorCostLabel()}
              @change=${this.toggleCursorCostLabel}
            ></setting-toggle>
          </div>`,
        })}
        ${zfTile({
          title: translateText("zf_settings.tile_alerts_privacy"),
          body: html`<div class="zf-chips">
            <setting-toggle
              chip
              label="${translateText("user_setting.lobby_start_alerts_label")}"
              description="${translateText(
                "user_setting.lobby_start_alerts_desc",
              )}"
              id="lobby-start-alerts-toggle"
              .checked=${this.userSettings.lobbyStartAlerts()}
              @change=${this.toggleLobbyStartAlerts}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.alert_frame_label")}"
              description="${translateText("user_setting.alert_frame_desc")}"
              id="alert-frame-toggle"
              .checked=${this.userSettings.alertFrame()}
              @change=${this.toggleAlertFrame}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.anonymous_names_label")}"
              description="${translateText(
                "user_setting.anonymous_names_desc",
              )}"
              id="anonymous-names-toggle"
              .checked=${this.userSettings.anonymousNames()}
              @change=${this.toggleAnonymousNames}
            ></setting-toggle>
            <setting-toggle
              chip
              label="${translateText("user_setting.lobby_id_visibility_label")}"
              description="${translateText(
                "user_setting.lobby_id_visibility_desc",
              )}"
              id="lobby-id-visibility-toggle"
              .checked=${!this.userSettings.lobbyIdVisibility()}
              @change=${this.toggleLobbyIdVisibility}
            ></setting-toggle>
          </div>`,
        })}
        ${zfTile({
          title: translateText("zf_settings.tile_attack"),
          body: html`
            <setting-slider
              compact
              label="${translateText("user_setting.attack_ratio_label")}"
              description="${translateText("user_setting.attack_ratio_desc")}"
              id="attack-ratio-slider"
              min="1"
              max="100"
              .value=${Math.round(this.currentAttackRatio() * 100)}
              @change=${this.sliderAttackRatio}
            ></setting-slider>
            <setting-select
              label=${translateText("user_setting.attack_ratio_increment_label")}
              description=${translateText(
                "user_setting.attack_ratio_increment_desc",
              )}
              .options=${[
                { value: 1, label: "1%" },
                { value: 2, label: "2%" },
                { value: 5, label: "5%" },
                { value: 10, label: "10%" },
                { value: 20, label: "20%" },
              ]}
              .value=${String(this.userSettings.attackRatioIncrement())}
              @change=${this.changeAttackRatioIncrement}
            ></setting-select>
          `,
        })}
        ${
          this.showEasterEggSettings
            ? zfTile({
                title: translateText("user_setting.development_only"),
                body: html`
                  <setting-slider
                    label="${translateText(
                      "user_setting.easter_writing_speed_label",
                    )}"
                    description="${translateText(
                      "user_setting.easter_writing_speed_desc",
                    )}"
                    min="0"
                    max="100"
                    value="40"
                    easter="true"
                    @change=${(e: CustomEvent) => {
                      const value = e.detail?.value;
                      if (value !== undefined) {
                        console.log("Changed:", value);
                      } else {
                        console.warn("Slider event missing detail.value", e);
                      }
                    }}
                  ></setting-slider>

                  <setting-number
                    label="${translateText(
                      "user_setting.easter_bug_count_label",
                    )}"
                    description="${translateText(
                      "user_setting.easter_bug_count_desc",
                    )}"
                    value="100"
                    min="0"
                    max="1000"
                    easter="true"
                    @change=${(e: CustomEvent) => {
                      const value = e.detail?.value;
                      if (value !== undefined) {
                        console.log("Changed:", value);
                      } else {
                        console.warn("Slider event missing detail.value", e);
                      }
                    }}
                  ></setting-number>
                `,
              })
            : nothing
        }
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.lastHasKeyboard = Platform.hasKeyboard;
    window.addEventListener("keydown", this.handleEasterEggKey);
    // Keybinds are editable from either instance and were only read in
    // connectedCallback, so re-read them or the other one renders stale.
    this.loadKeybindsFromStorage();
    if (typeof args?.onReturn === "function") {
      this.onReturn = args.onReturn as () => void;
    }
  }
}
