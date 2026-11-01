import { GameConfig } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { PauseGameIntentEvent } from "src/client/Transport";
import { type IconName, zfIcon } from "../../components/nightshift/Icon";
import { Controller } from "../../Controller";
import {
  AlternateViewEvent,
  ToggleRenderDebugGuiEvent,
} from "../../InputHandler";
import type { UserSettingModal } from "../../UserSettingModal";
import {
  disabledUnitsBox,
  hostCheatsBox,
  LOBBY_SETTING_TAG,
  lobbySettingTagText,
  notableLobbySettings,
} from "../../utilities/LobbySettingsSummary";
import { homeHref, translateText } from "../../Utils";
import type { GameView } from "../../view/GameView";

/** zfront's source, linked from the menu (AGPL-3.0 section 13). */
const SOURCE_URL = "https://github.com/sycus1/zfront";

export class ShowSettingsModalEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
}

/**
 * The in-game menu.
 *
 * It holds what is session state or a game action — the alternate (terrain)
 * view, the debug GUI, exiting — plus the game's modifiers (the non-default
 * lobby settings the join modal shows) and a link into the settings modal.
 * Every `UserSettings`-backed row it used to duplicate, the advanced graphics
 * options included, now lives in `UserSettingModal`, which this opens through
 * the non-inline `#game-settings` instance so both entry points render the
 * same UI.
 */
@customElement("settings-modal")
export class SettingsModal extends LitElement implements Controller {
  public eventBus: EventBus;

  @state()
  private isVisible: boolean = false;

  @state()
  private alternateView: boolean = false;

  @query(".modal-overlay")
  private modalOverlay!: HTMLElement;

  @property({ type: Boolean })
  shouldPause = false;

  @property({ type: Boolean })
  wasPausedWhenOpened = false;

  @property({ attribute: false })
  gameConfig: GameConfig | null = null;

  /** Nations the map defines; null skips the nation-count comparison. */
  @property({ attribute: false })
  mapNationCount: number | null = null;

  /** The running game, for saving it. */
  @property({ attribute: false })
  game: GameView | null = null;

  init() {
    this.eventBus.on(ShowSettingsModalEvent, (event) => {
      this.isVisible = event.isVisible;
      this.shouldPause = event.shouldPause;
      this.wasPausedWhenOpened = event.isPaused;
      this.pauseGame(true);
    });
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("click", this.handleOutsideClick, true);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("click", this.handleOutsideClick, true);
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleOutsideClick = (event: MouseEvent) => {
    if (
      this.isVisible &&
      this.modalOverlay &&
      event.target === this.modalOverlay
    ) {
      this.closeModal();
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.isVisible && event.key === "Escape") {
      this.closeModal();
    }
  };

  /** Whether the menu is showing. */
  get open(): boolean {
    return this.isVisible;
  }

  public openModal() {
    this.isVisible = true;
    this.requestUpdate();
  }

  public closeModal({ keepPause = false }: { keepPause?: boolean } = {}) {
    this.isVisible = false;
    this.requestUpdate();
    if (!keepPause) this.pauseGame(false);
  }

  private pauseGame(pause: boolean) {
    // Only pause the simulation itself when we own the pause (singleplayer or
    // lobby creator).
    if (this.shouldPause && !this.wasPausedWhenOpened) {
      this.eventBus.emit(new PauseGameIntentEvent(pause));
    }
  }

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onOpenSettingsButtonClick() {
    // index.html hides the page's inline <user-setting id="page-settings">
    // during a match, so the HUD addresses its own non-inline instance by id.
    const gameSettings = document.getElementById(
      "game-settings",
    ) as UserSettingModal | null;
    if (gameSettings === null || typeof gameSettings.open !== "function") {
      // Leave this menu open: closing it would strand the player with neither
      // the settings modal nor a menu.
      console.warn("In-game settings modal (#game-settings) not found");
      return;
    }
    // Keep the pause. Nothing releases it until this menu itself closes, and
    // UserSettingModal knows nothing about pausing — it only calls onReturn.
    this.closeModal({ keepPause: true });
    gameSettings.open({
      tab: "gameplay",
      // Reopen directly rather than re-emitting ShowSettingsModalEvent: init()
      // runs pauseGame(true) on every event, which would emit a second
      // PauseGameIntentEvent(true).
      onReturn: () => this.openModal(),
    });
  }

  private onRenderDebugGuiButtonClick() {
    this.eventBus.emit(new ToggleRenderDebugGuiEvent());
    this.closeModal();
  }

  private onExitButtonClick() {
    // redirect to the home page
    window.location.href = homeHref();
  }

  private renderModifiers() {
    const c = this.gameConfig;
    if (c === null) return null;
    const settings = notableLobbySettings(c, this.mapNationCount);
    const disabledUnits = disabledUnitsBox(c, "mt-1");
    const hostCheats = hostCheatsBox(c, "mt-1");
    if (settings.length === 0 && disabledUnits === null && hostCheats === null)
      return null;
    return html`
      <div class="zf-game-menu-section" data-game-modifiers>
        <div class="zf-hud-label">
          ${translateText("user_setting.modifiers")}
        </div>
        ${
          settings.length > 0
            ? html`<div class="flex flex-wrap gap-1.5" data-modifier-tags>
                ${settings.map(
                  (s) =>
                    html`<span class=${LOBBY_SETTING_TAG}
                      >${lobbySettingTagText(s)}</span
                    >`,
                )}
              </div>`
            : null
        }
        ${disabledUnits} ${hostCheats}
      </div>
    `;
  }

  /** One row of the menu: an icon, a title, a line about it. */
  private menuItem(opts: {
    icon: IconName;
    title: string;
    desc: string;
    onClick: () => void;
    end?: string;
    danger?: boolean;
    attrs?: string;
  }): TemplateResult {
    return html`<span class="zf-ring">
      <button
        type="button"
        class="zf-game-menu-item zf-frame zf-sweep ${opts.danger ? "zf-game-menu-item-danger" : ""}"
        ?data-open-settings=${opts.attrs === "open-settings"}
        @click=${opts.onClick}
      >
        ${zfIcon(opts.icon, 22)}
        <span class="zf-game-menu-text">
          <span class="zf-game-menu-title">${opts.title}</span>
          <span class="zf-game-menu-desc">${opts.desc}</span>
        </span>
        ${
          opts.end
            ? html`<span class="zf-num text-[13px] text-zf-signal-400"
                >${opts.end}</span
              >`
            : nothing
        }
      </button>
    </span>`;
  }

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="modal-overlay zf-dialog-scrim"
        style="z-index: 2000"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="zf-dialog zf-dialog-wide zf-frame max-h-[85vh] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-menu-title"
        >
          <h2 id="game-menu-title" class="zf-dialog-title uppercase">
            ${translateText("user_setting.game_menu_title")}
          </h2>
          <span class="zf-ring zf-dialog-close">
            <button
              type="button"
              class="zf-icon-btn zf-frame zf-sweep"
              aria-label=${translateText("common.close")}
              @click=${() => this.closeModal()}
            >
              ${zfIcon("close", 18, 3)}
            </button>
          </span>

          <div class="zf-game-menu">
            ${this.menuItem({
              icon: "gear",
              title: translateText("user_setting.open_settings_label"),
              desc: translateText("user_setting.open_settings_desc"),
              onClick: this.onOpenSettingsButtonClick,
              attrs: "open-settings",
            })}
            ${this.menuItem({
              icon: "map",
              title: translateText("user_setting.toggle_terrain"),
              desc: translateText("user_setting.toggle_view_desc"),
              onClick: this.onTerrainButtonClick,
              end: this.alternateView
                ? translateText("user_setting.on")
                : translateText("user_setting.off"),
            })}
            ${this.renderModifiers()}

            <div class="zf-game-menu-section">
              <div class="zf-hud-label">
                ${translateText("user_setting.development_only")}
              </div>
              ${this.menuItem({
                icon: "gear",
                title: translateText("user_setting.render_debug_gui"),
                desc: translateText("user_setting.render_debug_gui_desc"),
                onClick: this.onRenderDebugGuiButtonClick,
              })}
            </div>

            <div class="zf-game-menu-section">
              <span class="zf-ring">
                <a
                  class="zf-game-menu-item zf-frame zf-sweep"
                  href=${SOURCE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-source-link
                >
                  ${zfIcon("code", 22)}
                  <span class="zf-game-menu-text">
                    <span class="zf-game-menu-title"
                      >${translateText("user_setting.source_code")}</span
                    >
                    <span class="zf-game-menu-desc"
                      >${translateText("main.licence_notice")}</span
                    >
                  </span>
                </a>
              </span>
              ${this.menuItem({
                icon: "exit",
                title: translateText("user_setting.exit_game_label"),
                desc: translateText("user_setting.exit_game_info"),
                onClick: this.onExitButtonClick,
                danger: true,
              })}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
