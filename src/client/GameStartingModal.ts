import { assetUrl } from "@openfront/shared/AssetUrls";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

/**
 * The loading screen shown while a game starts: the stacked lockup on a
 * Night Shift tile, the licence line (which the AGPL Section 7 terms keep
 * visible here as on every menu screen), credits, and the status.
 */
@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  createRenderRoot() {
    return this;
  }

  render() {
    const isVisible = this.isVisible;
    return html`
      <div
        class="fixed inset-0 bg-zf-ink-900/80 z-[9998] transition-opacity duration-300 motion-reduce:transition-none ${
          isVisible ? "opacity-100 visible" : "opacity-0 invisible"
        }"
      ></div>
      <div
        role="status"
        aria-live="polite"
        class="zf-frame zf-frame-lg fixed top-1/2 left-1/2 z-[9999] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-5 px-6 py-8 text-center font-zf-body text-zf-cream-100 [--zf-fill:var(--color-zf-ink-900)] [--zf-border:var(--color-zf-line-600)] transition-opacity duration-300 motion-reduce:transition-none ${
          isVisible ? "opacity-100 visible" : "opacity-0 invisible"
        }"
      >
        <img
          src=${assetUrl("images/logo/zfront-lockup-stacked.svg")}
          alt=${translateText("main.logo_alt")}
          class="block h-[120px] w-auto"
          draggable="false"
        />
        <p
          class="m-0 font-zf-display font-black text-[38px] leading-none uppercase text-zf-signal-400"
        >
          ${translateText("game_starting_modal.title")}
        </p>
        <div
          class="flex flex-col items-center gap-1 text-[13px] leading-[18px] font-semibold"
        >
          <p class="m-0">${translateText("main.licence_notice")}</p>
          <p class="m-0 text-zf-muted-300">
            ${translateText("game_starting_modal.code_license")}
          </p>
          <a
            href="https://github.com/sycus1/zfront/blob/main/CREDITS.md"
            target="_blank"
            rel="noopener noreferrer"
            class="text-zf-signal-400 underline underline-offset-[3px] hover:text-zf-cream-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
            >${translateText("game_starting_modal.credits")}</a
          >
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
