import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { type IconName, zfIcon } from "./components/nightshift/Icon";
import { whenModalLoaded } from "./LazyModals";
import type { SinglePlayerModal } from "./SinglePlayerModal";
import { UsernameInput } from "./UsernameInput";
import { translateText } from "./Utils";

/**
 * The main menu's actions, inside its yellow panel: PLAY SOLO, then Tutorial,
 * Settings and Help. Settings and Help are `.nav-menu-item[data-page]`
 * buttons, which Navigation.ts routes to their inline pages.
 */
@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private inputValid: boolean = true;

  createRenderRoot() {
    return this;
  }

  // Silent backstop; the buttons are already disabled while input is invalid.
  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    // Pick up the current value in case username-input validated before us.
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
  }

  disconnectedCallback() {
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    whenModalLoaded("single-player-modal", () =>
      (
        document.querySelector("single-player-modal") as SinglePlayerModal
      )?.open(),
    );
  };

  private renderLink(
    label: string,
    icon: IconName,
    extra: { class?: string; page?: string; soon?: boolean },
    onClick?: () => void,
  ) {
    return html`
      <div class="zf-ring">
        <button
          type="button"
          class="zf-menu-link zf-frame zf-sweep ${extra.class ?? ""}"
          data-page=${ifDefined(extra.page)}
          ?disabled=${extra.soon}
          @click=${onClick}
        >
          ${zfIcon(icon, 20, 2.6, "zf-menu-link-icon")}
          <span>${label}</span>
          ${
            extra.soon
              ? html`<span class="zf-menu-link-soon"
                  >${translateText("common.coming_soon")}</span
                >`
              : nothing
          }
          ${zfIcon("arrow-right", 22, 3, "zf-menu-link-arrow")}
        </button>
      </div>
    `;
  }

  render() {
    return html`
      <div class="flex flex-col gap-3.5 sm:gap-5">
        <div class="zf-ring">
          <button
            type="button"
            class="zf-btn zf-btn-ink zf-btn-lg zf-frame zf-sweep"
            ?disabled=${!this.inputValid}
            @click=${this.openSinglePlayerModal}
          >
            <span>${translateText("main.play_solo")}</span>
            ${zfIcon("arrow-right", 36, 3)}
          </button>
        </div>
        <nav class="zf-menu-links" aria-label=${translateText("main.menu")}>
          ${this.renderLink(translateText("main.tutorial"), "book", {
            soon: true,
          })}
          ${this.renderLink(translateText("main.settings"), "gear", {
            class: "nav-menu-item",
            page: "page-settings",
          })}
          ${this.renderLink(translateText("main.help"), "help", {
            class: "nav-menu-item",
            page: "page-help",
          })}
        </nav>
      </div>
    `;
  }
}
