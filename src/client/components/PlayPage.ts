import { assetUrl } from "@openfront/shared/AssetUrls";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { translateText } from "../Utils";
import "./IOSAddToHomeScreenBanner";

/**
 * The main menu (Night Shift, "B2 Live Feed"): the wordmark with the hazard
 * stripe under it, and the yellow panel with the player's name, PLAY SOLO and
 * the links to Tutorial, Settings and Help. The live feed behind it is
 * <zf-live-feed> in index.html.
 *
 * Desktop: the wordmark and the panel side by side, the panel a cut tile.
 * Phone (under 640px): the wordmark at the top, the panel full-bleed along the
 * bottom with the links as three icon buttons.
 *
 * On a wide screen the row stops at 1680px and centres, so the panel stays
 * beside the wordmark rather than drifting to the far edge.
 *
 * The wordmark's clear space is a quarter of its cap height, and the hazard
 * stripe is the one element allowed that close (Logos README).
 */
@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="page-play"
        class="relative flex flex-1 flex-col w-full min-h-0 mx-auto max-w-[1680px] font-zf-body text-zf-signal-400
          [--zf-logo-h:102px] sm:[--zf-logo-h:clamp(96px,15.2vw,224px)]
          sm:flex-row sm:flex-wrap sm:items-start sm:gap-[clamp(24px,4vw,56px)]
          sm:px-(--zf-gutter) sm:py-[clamp(24px,4vw,56px)]"
      >
        <header
          class="flex flex-col gap-[calc(var(--zf-logo-h)/4)] px-4 pt-7 sm:p-0 sm:flex-[999_1_560px] sm:min-w-0"
        >
          <h1 class="m-0">
            <img
              src=${assetUrl("images/logo/zfront-wordmark.svg")}
              alt=${translateText("main.logo_alt")}
              class="block h-(--zf-logo-h) w-auto max-w-full"
              draggable="false"
            />
          </h1>
          <div
            class="zf-hazard h-[14px] [--zf-stripe-step:12px] sm:h-[22px] sm:[--zf-stripe-step:18px] sm:max-w-[760px]"
            aria-hidden="true"
          ></div>
        </header>

        <ios-add-to-home-screen-banner
          class="no-game-portal px-4 pt-4 sm:hidden [&:empty]:hidden"
        ></ios-add-to-home-screen-banner>

        <div class="flex-1 min-h-[160px] sm:hidden" aria-hidden="true"></div>

        <section
          aria-label=${translateText("main.play")}
          class="zf-menu-panel zf-frame flex flex-col gap-3.5 px-4 py-5 sm:gap-5 sm:p-7 sm:flex-[1_1_340px] sm:max-w-[440px]"
        >
          <username-input class="relative block w-full"></username-input>
          <game-mode-selector class="block"></game-mode-selector>
        </section>
      </div>
    `;
  }
}
