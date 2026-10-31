import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { currentGameVersion } from "../GameVersion";
import { translateText } from "../Utils";

/**
 * The Night Shift footer on every menu screen. It carries the licence line
 * "© OpenFront and Contributors · AGPL-3.0", which the AGPL Section 7 terms in
 * LICENSE require to stay visible, so it must never be dropped or hidden on a
 * menu page.
 */
@customElement("page-footer")
export class Footer extends LitElement {
  // Per instance, not at module scope: currentGameVersion reads
  // BOOTSTRAP_CONFIG, which the server injects into the page and which is not
  // guaranteed to exist at the moment this module is first imported.
  private readonly gameVersion = currentGameVersion();

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer class="zf-footer [.in-game_&]:hidden relative z-50">
        <p class="m-0 flex flex-wrap items-center gap-x-2">
          <span>${translateText("main.licence_notice")}</span>
          <span aria-hidden="true">·</span>
          <span>${translateText("main.alpha")}</span>
          <span class="footer-version font-zf-data text-xs text-zf-muted-300"
            >${this.gameVersion}</span
          >
        </p>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-1">
          <nav
            class="flex flex-wrap gap-x-5 gap-y-1"
            aria-label=${translateText("main.legal")}
          >
            <a href="/privacy-policy.html" target="_blank"
              >${translateText("main.privacy_policy")}</a
            >
            <a href="/terms-of-service.html" target="_blank"
              >${translateText("main.terms_of_service")}</a
            >
            <button
              type="button"
              class="nav-menu-item"
              data-page="page-troubleshooting"
            >
              ${translateText("main.troubleshooting")}
            </button>
            <a
              href="https://github.com/sycus1/zfront"
              target="_blank"
              rel="noopener noreferrer"
              >${translateText("main.github")}</a
            >
          </nav>
          <!-- Single instance: translateText() resolves the active language
               via document.querySelector("lang-selector"), so a second one
               would shadow it. -->
          <lang-selector></lang-selector>
        </div>
      </footer>
    `;
  }
}
