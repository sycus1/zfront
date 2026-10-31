import type { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  formatKeyForDisplay,
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
import { modalHeader } from "./components/ui/ModalHeader";
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

// Set by the inline script at the top of <body> in index.html.
function isHalloweenSeason(): boolean {
  return document.body.dataset.halloweenSeason !== undefined;
}

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
      const displayKey = formatKeyForDisplay(key || value);
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: html`
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 text-red-500 inline-block align-middle mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span class="font-medium">
                ${(() => {
                  const placeholder = "__KEY__";
                  const message = translateText(
                    "user_setting.keybind_conflict_error",
                    { key: placeholder },
                  );
                  const [prefix, suffix] = message.split(placeholder);
                  return html`${prefix}<span
                      class="font-mono font-bold bg-white/10 px-1.5 py-0.5 rounded text-red-200 mx-1 border border-white/10"
                      >${displayKey}</span
                    >${suffix || ""}`;
                })()}
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
      "fixed top-10 left-1/2 p-4 px-6 bg-black/80 text-white text-xl rounded-xl animate-fadePop z-[9999]";
    popup.textContent = "🎉 You found a secret setting!";
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

  private toggleHalloweenTheme() {
    this.userSettings.toggleHalloweenTheme();
    document.body.classList.toggle(
      "halloween-theme",
      isHalloweenSeason() && this.userSettings.halloweenTheme(),
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
    return html`
      <button
        id="audio-${category}-test"
        class="self-end px-3 py-1 text-sm font-medium rounded-lg border border-white/10 text-white transition-colors ${
          muted || pending
            ? "opacity-40 cursor-not-allowed"
            : "bg-white/5 hover:bg-white/15"
        }"
        ?disabled=${muted || pending}
        title=${muted ? translateText(hint) : ""}
        @click=${() => this.playTestCue(category)}
      >
        ${translateText("user_setting.audio_test")}
      </button>
    `;
  }

  private renderVolumeSlider(category: AudioCategory) {
    const controls = audioControls();
    return html`
      <div class="flex flex-col gap-2">
        <setting-slider
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
            ? html`<div class="flex justify-end">
                ${this.renderTestButton(controls, category as CueCategory)}
              </div>`
            : ""
        }
      </div>
    `;
  }

  private renderAudioSettings() {
    const muteOnBlur = this.userSettings.muteOnBlur();
    return html`
      ${AUDIO_TAB_ORDER.map((category) => this.renderVolumeSlider(category))}

      <setting-toggle
        label="${translateText("user_setting.audio_mute_on_blur")}"
        description="${translateText("user_setting.audio_mute_on_blur_desc")}"
        id="audio-mute-on-blur-toggle"
        .checked=${muteOnBlur}
        @change=${this.toggleMuteOnBlur}
      ></setting-toggle>

      <!-- Dependent on the row above: meaningless when nothing is muted. -->
      <div class="pl-6">
        <setting-toggle
          label="${translateText("user_setting.audio_alerts_when_unfocused")}"
          description="${translateText(
            "user_setting.audio_alerts_when_unfocused_desc",
          )}"
          id="audio-alerts-when-unfocused-toggle"
          .checked=${this.userSettings.alertsWhenUnfocused()}
          ?disabled=${!muteOnBlur}
          @change=${this.toggleAlertsWhenUnfocused}
        ></setting-toggle>
      </div>

      <div class="flex justify-end pt-2">
        <button
          id="audio-reset"
          class="px-3 py-1 text-sm font-medium rounded-lg border border-white/10 text-white bg-white/5 hover:bg-white/15 transition-colors"
          @click=${this.resetAudio}
        >
          ${translateText("user_setting.audio_reset")}
        </button>
      </div>
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

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("user_setting.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      showDivider: true,
    });
  }

  protected renderBody(tab: string) {
    let body;
    switch (tab) {
      case "keybinds":
        body = this.renderKeybindSettings();
        break;
      case "audio":
        body = this.renderAudioSettings();
        break;
      case "graphics":
        body = this.renderGraphicsSettings();
        break;
      default:
        body = this.renderGameplaySettings();
    }
    return html`
      <div class="flex flex-col gap-2 p-4 lg:p-[1.4rem]">${body}</div>
    `;
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

  private renderKeybindSettings() {
    return html`
      <div
        class="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300/70 text-xs"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5 shrink-0 opacity-70"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        ${translateText("user_setting.keybinds_hint")}
      </div>

      <h2
        class="text-blue-200 text-xl font-bold mt-4 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.view_options")}
      </h2>

      <setting-keybind
        action="toggleView"
        label=${translateText("user_setting.toggle_view")}
        description=${translateText("user_setting.toggle_view_desc")}
        defaultKey=${this.defaultKeybinds.toggleView}
        .value=${this.getKeyValue("toggleView")}
        .display=${this.getKeyChar("toggleView")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="coordinateGrid"
        label=${translateText("user_setting.coordinate_grid_label")}
        description=${translateText("user_setting.coordinate_grid_desc")}
        defaultKey=${this.defaultKeybinds.coordinateGrid}
        .value=${this.getKeyValue("coordinateGrid")}
        .display=${this.getKeyChar("coordinateGrid")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="altKey"
        .allowModifiers=${true}
        label=${translateText("user_setting.graphics_refresh_modifier")}
        description=${translateText(
          "user_setting.graphics_refresh_modifier_desc",
          { key: this.getKeyChar("resetGfx").toUpperCase() },
        )}
        .defaultKey=${this.defaultKeybinds.altKey}
        .value=${this.getKeyValue("altKey")}
        .display=${this.getKeyChar("altKey")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="resetGfx"
        label=${translateText("help_modal.action_reset_gfx")}
        description=${translateText("user_setting.reset_gfx_desc")}
        .defaultKey=${this.defaultKeybinds.resetGfx}
        .value=${this.getKeyValue("resetGfx")}
        .display=${this.getKeyChar("resetGfx")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.build_controls")}
      </h2>

      <setting-keybind
        action="buildCity"
        label=${translateText("user_setting.build_city")}
        description=${translateText("user_setting.build_city_desc")}
        defaultKey=${this.defaultKeybinds.buildCity}
        .value=${this.getKeyValue("buildCity")}
        .display=${this.getKeyChar("buildCity")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildFactory"
        label=${translateText("user_setting.build_factory")}
        description=${translateText("user_setting.build_factory_desc")}
        defaultKey=${this.defaultKeybinds.buildFactory}
        .value=${this.getKeyValue("buildFactory")}
        .display=${this.getKeyChar("buildFactory")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildPort"
        label=${translateText("user_setting.build_port")}
        description=${translateText("user_setting.build_port_desc")}
        defaultKey=${this.defaultKeybinds.buildPort}
        .value=${this.getKeyValue("buildPort")}
        .display=${this.getKeyChar("buildPort")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildDefensePost"
        label=${translateText("user_setting.build_defense_post")}
        description=${translateText("user_setting.build_defense_post_desc")}
        defaultKey=${this.defaultKeybinds.buildDefensePost}
        .value=${this.getKeyValue("buildDefensePost")}
        .display=${this.getKeyChar("buildDefensePost")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildWall"
        label=${translateText("user_setting.build_wall")}
        description=${translateText("user_setting.build_wall_desc")}
        defaultKey=${this.defaultKeybinds.buildWall}
        .value=${this.getKeyValue("buildWall")}
        .display=${this.getKeyChar("buildWall")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildOutpost"
        label=${translateText("user_setting.build_outpost")}
        description=${translateText("user_setting.build_outpost_desc")}
        defaultKey=${this.defaultKeybinds.buildOutpost}
        .value=${this.getKeyValue("buildOutpost")}
        .display=${this.getKeyChar("buildOutpost")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildDepot"
        label=${translateText("user_setting.build_depot")}
        description=${translateText("user_setting.build_depot_desc")}
        defaultKey=${this.defaultKeybinds.buildDepot}
        .value=${this.getKeyValue("buildDepot")}
        .display=${this.getKeyChar("buildDepot")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMine"
        label=${translateText("user_setting.build_mine")}
        description=${translateText("user_setting.build_mine_desc")}
        defaultKey=${this.defaultKeybinds.buildMine}
        .value=${this.getKeyValue("buildMine")}
        .display=${this.getKeyChar("buildMine")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildNoiseBeacon"
        label=${translateText("user_setting.build_noise_beacon")}
        description=${translateText("user_setting.build_noise_beacon_desc")}
        defaultKey=${this.defaultKeybinds.buildNoiseBeacon}
        .value=${this.getKeyValue("buildNoiseBeacon")}
        .display=${this.getKeyChar("buildNoiseBeacon")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMissileSilo"
        label=${translateText("user_setting.build_missile_silo")}
        description=${translateText("user_setting.build_missile_silo_desc")}
        defaultKey=${this.defaultKeybinds.buildMissileSilo}
        .value=${this.getKeyValue("buildMissileSilo")}
        .display=${this.getKeyChar("buildMissileSilo")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildSamLauncher"
        label=${translateText("user_setting.build_sam_launcher")}
        description=${translateText("user_setting.build_sam_launcher_desc")}
        defaultKey=${this.defaultKeybinds.buildSamLauncher}
        .value=${this.getKeyValue("buildSamLauncher")}
        .display=${this.getKeyChar("buildSamLauncher")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildWarship"
        label=${translateText("user_setting.build_warship")}
        description=${translateText("user_setting.build_warship_desc")}
        defaultKey=${this.defaultKeybinds.buildWarship}
        .value=${this.getKeyValue("buildWarship")}
        .display=${this.getKeyChar("buildWarship")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildAtomBomb"
        label=${translateText("user_setting.build_atom_bomb")}
        description=${translateText("user_setting.build_atom_bomb_desc")}
        defaultKey=${this.defaultKeybinds.buildAtomBomb}
        .value=${this.getKeyValue("buildAtomBomb")}
        .display=${this.getKeyChar("buildAtomBomb")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildHydrogenBomb"
        label=${translateText("user_setting.build_hydrogen_bomb")}
        description=${translateText("user_setting.build_hydrogen_bomb_desc")}
        defaultKey=${this.defaultKeybinds.buildHydrogenBomb}
        .value=${this.getKeyValue("buildHydrogenBomb")}
        .display=${this.getKeyChar("buildHydrogenBomb")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMIRV"
        label=${translateText("user_setting.build_mirv")}
        description=${translateText("user_setting.build_mirv_desc")}
        defaultKey=${this.defaultKeybinds.buildMIRV}
        .value=${this.getKeyValue("buildMIRV")}
        .display=${this.getKeyChar("buildMIRV")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.menu_shortcuts")}
      </h2>

      <setting-keybind
        action="buildMenuModifier"
        .allowModifiers=${true}
        label=${translateText("user_setting.build_menu_modifier")}
        description=${translateText("user_setting.build_menu_modifier_desc")}
        .defaultKey=${this.defaultKeybinds.buildMenuModifier}
        .value=${this.getKeyValue("buildMenuModifier")}
        .display=${this.getKeyChar("buildMenuModifier")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="emojiMenuModifier"
        .allowModifiers=${true}
        label=${translateText("user_setting.emoji_menu_modifier")}
        description=${translateText("user_setting.emoji_menu_modifier_desc")}
        .defaultKey=${this.defaultKeybinds.emojiMenuModifier}
        .value=${this.getKeyValue("emojiMenuModifier")}
        .display=${this.getKeyChar("emojiMenuModifier")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="boxSelectWarships"
        .allowModifiers=${true}
        label=${translateText("user_setting.box_select_warships")}
        description=${translateText("user_setting.box_select_warships_desc")}
        .defaultKey=${this.defaultKeybinds.boxSelectWarships}
        .value=${this.getKeyValue("boxSelectWarships")}
        .display=${this.getKeyChar("boxSelectWarships")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="selectAllWarships"
        label=${translateText("user_setting.select_all_warships")}
        description=${translateText("user_setting.select_all_warships_desc")}
        .defaultKey=${this.defaultKeybinds.selectAllWarships}
        .value=${this.getKeyValue("selectAllWarships")}
        .display=${this.getKeyChar("selectAllWarships")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="pauseGame"
        label=${translateText("user_setting.pause_game")}
        description=${translateText("user_setting.pause_game_desc")}
        .defaultKey=${this.defaultKeybinds.pauseGame}
        .value=${this.getKeyValue("pauseGame")}
        .display=${this.getKeyChar("pauseGame")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="gameSpeedUp"
        label=${translateText("user_setting.game_speed_up")}
        description=${translateText("user_setting.game_speed_up_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedUp}
        .value=${this.getKeyValue("gameSpeedUp")}
        .display=${this.getKeyChar("gameSpeedUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="gameSpeedDown"
        label=${translateText("user_setting.game_speed_down")}
        description=${translateText("user_setting.game_speed_down_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedDown}
        .value=${this.getKeyValue("gameSpeedDown")}
        .display=${this.getKeyChar("gameSpeedDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_ratio_controls")}
      </h2>

      <setting-keybind
        action="attackRatioDown"
        label=${translateText("user_setting.attack_ratio_down")}
        description=${translateText("user_setting.attack_ratio_down_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
        defaultKey=${this.defaultKeybinds.attackRatioDown}
        .value=${this.getKeyValue("attackRatioDown")}
        .display=${this.getKeyChar("attackRatioDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="attackRatioUp"
        label=${translateText("user_setting.attack_ratio_up")}
        description=${translateText("user_setting.attack_ratio_up_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
        defaultKey=${this.defaultKeybinds.attackRatioUp}
        .value=${this.getKeyValue("attackRatioUp")}
        .display=${this.getKeyChar("attackRatioUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_keybinds")}
      </h2>

      <setting-keybind
        action="boatAttack"
        label=${translateText("user_setting.boat_attack")}
        description=${translateText("user_setting.boat_attack_desc")}
        defaultKey=${this.defaultKeybinds.boatAttack}
        .value=${this.getKeyValue("boatAttack")}
        .display=${this.getKeyChar("boatAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="groundAttack"
        label=${translateText("user_setting.ground_attack")}
        description=${translateText("user_setting.ground_attack_desc")}
        defaultKey=${this.defaultKeybinds.groundAttack}
        .value=${this.getKeyValue("groundAttack")}
        .display=${this.getKeyChar("groundAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="retaliateAttack"
        label=${translateText("user_setting.retaliate_attack")}
        description=${translateText("user_setting.retaliate_attack_desc")}
        defaultKey=${this.defaultKeybinds.retaliateAttack}
        .value=${this.getKeyValue("retaliateAttack")}
        .display=${this.getKeyChar("retaliateAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="swapDirection"
        label=${translateText("user_setting.swap_direction")}
        description=${translateText("user_setting.swap_direction_desc")}
        .defaultKey=${this.defaultKeybinds.swapDirection}
        .value=${this.getKeyValue("swapDirection")}
        .display=${this.getKeyChar("swapDirection")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.ally_keybinds")}
      </h2>

      <setting-keybind
        action="targetPlayer"
        label=${translateText("user_setting.target_player")}
        description=${translateText("user_setting.target_player_desc")}
        defaultKey=${this.defaultKeybinds.targetPlayer}
        .value=${this.getKeyValue("targetPlayer")}
        .display=${this.getKeyChar("targetPlayer")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="emojiMenu"
        label=${translateText("user_setting.emoji_menu")}
        description=${translateText("user_setting.emoji_menu_desc")}
        defaultKey=${this.defaultKeybinds.emojiMenu}
        .value=${this.getKeyValue("emojiMenu")}
        .display=${this.getKeyChar("emojiMenu")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="quickChat"
        label=${translateText("user_setting.quick_chat")}
        description=${translateText("user_setting.quick_chat_desc")}
        defaultKey=${this.defaultKeybinds.quickChat}
        .value=${this.getKeyValue("quickChat")}
        .display=${this.getKeyChar("quickChat")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.zoom_controls")}
      </h2>

      <setting-keybind
        action="zoomOut"
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        defaultKey=${this.defaultKeybinds.zoomOut}
        .value=${this.getKeyValue("zoomOut")}
        .display=${this.getKeyChar("zoomOut")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomOutMinus"
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        defaultKey=${this.defaultKeybinds.zoomOutMinus}
        .value=${this.getKeyValue("zoomOutMinus")}
        .display=${this.getKeyChar("zoomOutMinus")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomOutNumpad"
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        defaultKey=${this.defaultKeybinds.zoomOutNumpad}
        .value=${this.getKeyValue("zoomOutNumpad")}
        .display=${this.getKeyChar("zoomOutNumpad")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomIn"
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        defaultKey=${this.defaultKeybinds.zoomIn}
        .value=${this.getKeyValue("zoomIn")}
        .display=${this.getKeyChar("zoomIn")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomInEqual"
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        defaultKey=${this.defaultKeybinds.zoomInEqual}
        .value=${this.getKeyValue("zoomInEqual")}
        .display=${this.getKeyChar("zoomInEqual")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomInNumpad"
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        defaultKey=${this.defaultKeybinds.zoomInNumpad}
        .value=${this.getKeyValue("zoomInNumpad")}
        .display=${this.getKeyChar("zoomInNumpad")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.camera_movement")}
      </h2>

      <setting-keybind
        action="centerCamera"
        label=${translateText("user_setting.center_camera")}
        description=${translateText("user_setting.center_camera_desc")}
        defaultKey=${this.defaultKeybinds.centerCamera}
        .value=${this.getKeyValue("centerCamera")}
        .display=${this.getKeyChar("centerCamera")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveUp"
        label=${translateText("user_setting.move_up")}
        description=${translateText("user_setting.move_up_desc")}
        defaultKey=${this.defaultKeybinds.moveUp}
        .value=${this.getKeyValue("moveUp")}
        .display=${this.getKeyChar("moveUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveUpArrow"
        label=${translateText("user_setting.move_up")}
        description=${translateText("user_setting.move_up_desc")}
        .defaultKey=${this.defaultKeybinds.moveUpArrow}
        .value=${this.getKeyValue("moveUpArrow")}
        .display=${this.getKeyChar("moveUpArrow")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveLeft"
        label=${translateText("user_setting.move_left")}
        description=${translateText("user_setting.move_left_desc")}
        defaultKey=${this.defaultKeybinds.moveLeft}
        .value=${this.getKeyValue("moveLeft")}
        .display=${this.getKeyChar("moveLeft")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveLeftArrow"
        label=${translateText("user_setting.move_left")}
        description=${translateText("user_setting.move_left_desc")}
        .defaultKey=${this.defaultKeybinds.moveLeftArrow}
        .value=${this.getKeyValue("moveLeftArrow")}
        .display=${this.getKeyChar("moveLeftArrow")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveDown"
        label=${translateText("user_setting.move_down")}
        description=${translateText("user_setting.move_down_desc")}
        defaultKey=${this.defaultKeybinds.moveDown}
        .value=${this.getKeyValue("moveDown")}
        .display=${this.getKeyChar("moveDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveDownArrow"
        label=${translateText("user_setting.move_down")}
        description=${translateText("user_setting.move_down_desc")}
        .defaultKey=${this.defaultKeybinds.moveDownArrow}
        .value=${this.getKeyValue("moveDownArrow")}
        .display=${this.getKeyChar("moveDownArrow")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveRight"
        label=${translateText("user_setting.move_right")}
        description=${translateText("user_setting.move_right_desc")}
        defaultKey=${this.defaultKeybinds.moveRight}
        .value=${this.getKeyValue("moveRight")}
        .display=${this.getKeyChar("moveRight")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveRightArrow"
        label=${translateText("user_setting.move_right")}
        description=${translateText("user_setting.move_right_desc")}
        .defaultKey=${this.defaultKeybinds.moveRightArrow}
        .value=${this.getKeyValue("moveRightArrow")}
        .display=${this.getKeyChar("moveRightArrow")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>
    `;
  }

  /**
   * Purely visual switches — how the map and HUD are drawn. Anything that
   * changes how the game is played, or what the game tells you, belongs in
   * renderGameplaySettings() instead.
   */
  private renderGraphicsSettings() {
    return html`
      <setting-slider
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
      ></setting-slider>
      <!-- 🎨 Graphics preset -->
      <div
        class="flex flex-col w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-3"
      >
        <div class="flex flex-col min-w-0">
          <div class="text-white font-bold text-base block mb-1">
            ${translateText("user_setting.graphics_preset_label")}
          </div>
          <div class="text-white/50 text-sm leading-snug">
            ${translateText("user_setting.graphics_preset_desc")}
          </div>
        </div>
        <graphics-preset-selector></graphics-preset-selector>
      </div>

      <!-- 💾 Save / share the whole configuration. Top level, not inside
           Advanced: a player who never expands the fold should still find it. -->
      <graphics-preset-tools></graphics-preset-tools>

      <!-- 😊 Emojis -->
      <setting-toggle
        label="${translateText("user_setting.emojis_label")}"
        description="${translateText("user_setting.emojis_desc")}"
        id="emoji-toggle"
        .checked=${this.userSettings.emojis()}
        @change=${this.toggleEmojis}
      ></setting-toggle>

      <!-- 📱 Performance Overlay -->
      <setting-toggle
        label="${translateText("user_setting.performance_overlay_label")}"
        description="${translateText("user_setting.performance_overlay_desc")}"
        id="performance-overlay-toggle"
        .checked=${this.userSettings.performanceOverlay()}
        @change=${this.togglePerformanceOverlay}
      ></setting-toggle>

      <!-- 🗺️ Map Layers -->
      <setting-toggle
        label="${translateText("user_setting.map_layers_label")}"
        description="${translateText("user_setting.map_layers_desc")}"
        id="map-layers-toggle"
        .checked=${this.userSettings.mapLayers()}
        @change=${this.toggleMapLayers}
      ></setting-toggle>

      <!-- 🔧 Advanced -->
      <setting-toggle
        label="${translateText("graphics_setting.advanced_label")}"
        description="${translateText("graphics_setting.advanced_desc")}"
        id="graphics-advanced-toggle"
        .checked=${this.graphicsAdvancedOpen}
        @change=${this.toggleGraphicsAdvanced}
      ></setting-toggle>

      ${
        this.graphicsAdvancedOpen
          ? html`<graphics-advanced-settings></graphics-advanced-settings>`
          : nothing
      }
    `;
  }

  private renderGameplaySettings() {
    return html`
      <!-- 🚨 Alert frame -->
      <setting-toggle
        label="${translateText("user_setting.alert_frame_label")}"
        description="${translateText("user_setting.alert_frame_desc")}"
        id="alert-frame-toggle"
        .checked=${this.userSettings.alertFrame()}
        @change=${this.toggleAlertFrame}
      ></setting-toggle>

      <!-- 💰 Cursor Price Pill -->
      <setting-toggle
        label="${translateText("user_setting.cursor_cost_label_label")}"
        description="${translateText("user_setting.cursor_cost_label_desc")}"
        id="cursor_cost_label-toggle"
        .checked=${this.userSettings.cursorCostLabel()}
        @change=${this.toggleCursorCostLabel}
      ></setting-toggle>

      <!-- 🧲 Snap Build Preview -->
      <setting-toggle
        label="${translateText("user_setting.snap_build_preview_label")}"
        description="${translateText("user_setting.snap_build_preview_desc")}"
        id="snap-build-preview-toggle"
        .checked=${this.userSettings.snapBuildPreview()}
        @change=${this.toggleSnapBuildPreview}
      ></setting-toggle>

      <!-- 🖱️ Left Click Menu -->
      <setting-toggle
        label="${translateText("user_setting.left_click_label")}"
        description="${translateText("user_setting.left_click_desc")}"
        id="left-click-toggle"
        .checked=${this.userSettings.leftClickOpensMenu()}
        @change=${this.toggleLeftClickOpensMenu}
      ></setting-toggle>

      <!-- 🙈 Anonymous Names -->
      <setting-toggle
        label="${translateText("user_setting.anonymous_names_label")}"
        description="${translateText("user_setting.anonymous_names_desc")}"
        id="anonymous-names-toggle"
        .checked=${this.userSettings.anonymousNames()}
        @change=${this.toggleAnonymousNames}
      ></setting-toggle>

      <!-- 👁️ Hidden Lobby IDs -->
      <setting-toggle
        label="${translateText("user_setting.lobby_id_visibility_label")}"
        description="${translateText("user_setting.lobby_id_visibility_desc")}"
        id="lobby-id-visibility-toggle"
        .checked=${!this.userSettings.lobbyIdVisibility()}
        @change=${this.toggleLobbyIdVisibility}
      ></setting-toggle>

      <!-- 🔔 Lobby start alerts -->
      <setting-toggle
        label="${translateText("user_setting.lobby_start_alerts_label")}"
        description="${translateText("user_setting.lobby_start_alerts_desc")}"
        id="lobby-start-alerts-toggle"
        .checked=${this.userSettings.lobbyStartAlerts()}
        @change=${this.toggleLobbyStartAlerts}
      ></setting-toggle>

      <!-- 🔍 Go to player -->
      <setting-toggle
        label="${translateText("user_setting.go_to_player_label")}"
        description="${translateText("user_setting.go_to_player_desc")}"
        id="go-to-player-toggle"
        .checked=${this.userSettings.goToPlayer()}
        @change=${this.toggleGoToPlayer}
      ></setting-toggle>

      ${
        isHalloweenSeason()
          ? html`<setting-toggle
              label="${translateText("user_setting.halloween_theme_label")}"
              description="${translateText("user_setting.halloween_theme_desc")}"
              id="halloween-theme-toggle"
              .checked=${this.userSettings.halloweenTheme()}
              @change=${this.toggleHalloweenTheme}
            ></setting-toggle>`
          : null
      }

      <!-- Help messages (moved here from the in-game menu) -->
      <setting-toggle
        label="${translateText("user_setting.help_messages_label")}"
        description="${translateText("user_setting.help_messages_desc")}"
        id="help-messages-toggle"
        .checked=${this.userSettings.helpMessages()}
        @change=${this.toggleHelpMessages}
      ></setting-toggle>

      <!-- Attacking troops overlay (moved here from the in-game menu) -->
      <setting-toggle
        label="${translateText("user_setting.attacking_troops_overlay_label")}"
        description="${translateText(
          "user_setting.attacking_troops_overlay_desc",
        )}"
        id="attacking-troops-overlay-toggle"
        .checked=${this.userSettings.attackingTroopsOverlay()}
        @change=${this.toggleAttackingTroopsOverlay}
      ></setting-toggle>

      <!-- ⚔️ Attack Ratio -->
      <setting-slider
        label="${translateText("user_setting.attack_ratio_label")}"
        description="${translateText("user_setting.attack_ratio_desc")}"
        id="attack-ratio-slider"
        min="1"
        max="100"
        .value=${Math.round(this.currentAttackRatio() * 100)}
        @change=${this.sliderAttackRatio}
      ></setting-slider>

      <!-- ⚔️ Attack Ratio Increment -->
      <setting-select
        label=${translateText("user_setting.attack_ratio_increment_label")}
        description=${translateText("user_setting.attack_ratio_increment_desc")}
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

      ${
        this.showEasterEggSettings
          ? html`
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
                label="${translateText("user_setting.easter_bug_count_label")}"
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
            `
          : null
      }
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
