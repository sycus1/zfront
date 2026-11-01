import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Platform } from "../Platform";
import { translateText } from "../Utils";
import { zfIcon } from "./nightshift/Icon";
import { zfButton } from "./nightshift/Primitives";

const DISMISSED_KEY = "ios_a2hs_banner_dismissed";
const LATER_KEY = "ios_a2hs_banner_later";

@customElement("ios-add-to-home-screen-banner")
export class IOSAddToHomeScreenBanner extends LitElement {
  @state() private dismissed = false;
  @state() private later = false;
  @state() private showGuide = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    try {
      this.dismissed = localStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      this.dismissed = false;
    }
    try {
      this.later = sessionStorage.getItem(LATER_KEY) === "true";
    } catch {
      this.later = false;
    }
  }

  private never() {
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // localStorage unavailable — dismiss for session only
    }
    this.dismissed = true;
  }

  private later_() {
    try {
      sessionStorage.setItem(LATER_KEY, "true");
    } catch {
      // ignore — this.later still set in memory
    }
    this.later = true;
  }

  private openGuide() {
    this.showGuide = true;
  }

  private closeGuide() {
    this.showGuide = false;
  }

  private renderGuideModal() {
    if (!this.showGuide) return nothing;

    return html`
      <div
        class="zf-dialog-scrim items-end sm:items-center"
        style="z-index: 9999"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.closeGuide();
        }}
      >
        <div class="relative w-full max-w-sm">
          <div
            class="zf-dialog zf-frame"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-banner-modal-title"
          >
            <h2 id="ios-banner-modal-title" class="zf-dialog-title uppercase">
              ${translateText("ios_banner.modal_title")}
            </h2>
            <span class="zf-ring zf-dialog-close">
              <button
                type="button"
                class="zf-icon-btn zf-frame zf-sweep"
                @click=${this.closeGuide}
                aria-label=${translateText("common.close")}
              >
                ${zfIcon("close", 18, 3)}
              </button>
            </span>

            <p class="zf-dialog-message">
              ${translateText("ios_banner.modal_desc")}
            </p>

            <ol
              class="m-0 p-0 list-none flex flex-col gap-3 text-sm font-semibold"
            >
              <li class="flex items-start gap-3">
                <span
                  class="zf-keycap zf-frame shrink-0 !min-w-7 !min-h-7 !px-1.5 !text-xs"
                  >1</span
                >
                <span>${translateText("ios_banner.step_share")}</span>
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="zf-keycap zf-frame shrink-0 !min-w-7 !min-h-7 !px-1.5 !text-xs"
                  >2</span
                >
                <span
                  >${translateText("ios_banner.step_scroll_and_tap")}
                  <strong class="text-zf-signal-400"
                    >${translateText(
                      "ios_banner.step_add_to_home_label",
                    )}</strong
                  ></span
                >
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="zf-keycap zf-frame shrink-0 !min-w-7 !min-h-7 !px-1.5 !text-xs"
                  >3</span
                >
                <span>${translateText("ios_banner.step_open")}</span>
              </li>
            </ol>

            ${zfButton({
              label: translateText("ios_banner.got_it"),
              variant: "signal",
              onClick: this.closeGuide,
            })}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!Platform.isIOS) return nothing;
    if (this.dismissed || this.later) return nothing;
    if (
      (navigator as any).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return nothing;
    }

    return html`
      ${this.renderGuideModal()}
      <div
        class="zf-frame flex flex-col gap-3 w-full px-3 py-3 text-sm font-semibold text-zf-cream-100 [--zf-fill:var(--color-zf-tile-fill)] [--zf-border:var(--color-zf-line-600)]"
      >
        <div class="flex gap-3 items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="shrink-0 w-8 h-8 text-zf-signal-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="square"
            stroke-linejoin="miter"
            aria-hidden="true"
          >
            <rect x="5" y="2" width="14" height="20" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          <span>${translateText("ios_banner.text")}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          ${zfButton({
            label: translateText("ios_banner.how"),
            variant: "signal",
            size: "sm",
            onClick: this.openGuide,
          })}
          ${zfButton({
            label: translateText("ios_banner.later"),
            size: "sm",
            onClick: this.later_,
          })}
          ${zfButton({
            label: translateText("ios_banner.never"),
            size: "sm",
            onClick: this.never,
          })}
        </div>
      </div>
    `;
  }
}
