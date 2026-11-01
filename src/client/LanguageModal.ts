import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { BaseModal } from "./components/BaseModal";
import { zfIcon } from "./components/nightshift/Icon";

interface LanguageOption {
  code: string;
  svg: string;
  native: string;
  en: string;
}

@customElement("language-modal")
export class LanguageModal extends BaseModal {
  protected routerName = "language";

  @property({ type: Array }) languageList: LanguageOption[] = [];
  @property({ type: String }) currentLang = "en";

  private selectLanguage = (lang: string) => {
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        detail: { lang },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  };

  protected pageTitle(): string {
    return translateText("select_lang.title");
  }

  protected renderBody(): TemplateResult {
    // One framed radio per language; the current one in the yellow fill.
    return html`
      <div
        class="zf-langs"
        role="radiogroup"
        aria-label=${translateText("select_lang.title")}
      >
        ${this.languageList.map((lang) => {
          const isActive = this.currentLang === lang.code;
          return html`<div class="zf-ring">
            <button
              type="button"
              role="radio"
              aria-checked=${isActive ? "true" : "false"}
              lang=${lang.code === "debug" ? "en" : lang.code}
              class="zf-lang zf-frame zf-sweep"
              @click=${() => this.selectLanguage(lang.code)}
            >
              <img src=${assetUrl(`flags/${lang.svg}.svg`)} alt="" />
              <span class="zf-lang-names">
                <span class="zf-lang-native">${lang.native}</span>
                <span class="zf-lang-en">${lang.en}</span>
              </span>
              ${isActive ? zfIcon("check", 22, 3.5) : ""}
            </button>
          </div>`;
        })}
      </div>
    `;
  }
}
