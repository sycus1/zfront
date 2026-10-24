import { assetUrl } from "@openfront/shared/AssetUrls";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { currentGameVersion } from "../GameVersion";

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
      <footer
        class="[.in-game_&]:hidden bg-zinc-900/90 backdrop-blur-md flex flex-col items-center justify-center gap-1 pt-1 pb-3 text-white/50 w-full border-t border-white/10 shrink-0 relative z-50 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-0"
      >
        <!-- Icons and legal links stay centred on the bar; on desktop they
             share it with the language selector. -->
        <div
          class="flex w-full flex-col items-center gap-1 lg:col-start-2 lg:w-auto"
        >
          <div
            class="flex items-center justify-center gap-4 lg:gap-6 pt-2 w-full relative"
          >
            <a
              href="https://github.com/sycus1/zfront"
              target="_blank"
              rel="noopener noreferrer"
              class="opacity-60 hover:opacity-100 hover:scale-110 transition-all"
            >
              <img
                src=${assetUrl("icons/github-mark-white.svg")}
                data-i18n-alt="main.github"
                class="h-6 w-6 lg:h-7 lg:w-7 object-contain pointer-events-none"
                draggable="false"
              />
            </a>
          </div>
          <!-- The nav bar shows the game version alone so it reads the same
               across web and Steam; the full string, shell version included,
               lives down here where a player can quote it in a bug report. -->
          <div class="footer-version text-xs mt-1 lg:mt-2 text-center px-4">
            ${this.gameVersion}
          </div>
          <div
            class="text-xs mt-1 lg:mt-2 flex items-center justify-center gap-4 px-4"
          >
            <a
              href="/terms-of-service.html"
              data-i18n="main.terms_of_service"
              target="_blank"
              class="hover:text-white transition-colors"
            ></a>
            <span data-i18n="main.copyright"></span>
            <a
              href="/privacy-policy.html"
              data-i18n="main.privacy_policy"
              target="_blank"
              class="hover:text-white transition-colors"
            ></a>
          </div>
        </div>

        <!-- Single instance: translateText() resolves the active language via
             document.querySelector("lang-selector"), so a second one would
             shadow it. -->
        <lang-selector
          class="absolute right-4 top-3 lg:top-1/2 lg:-translate-y-1/2"
        ></lang-selector>
      </footer>
    `;
  }
}
