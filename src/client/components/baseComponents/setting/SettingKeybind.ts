import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { formatKeyForDisplay, translateText } from "../../../../client/Utils";
import { zfIcon } from "../../nightshift/Icon";

@customElement("setting-keybind")
export class SettingKeybind extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: String, reflect: true }) action = "";
  @property({ type: String }) defaultKey = "";
  @property({ type: String }) value = "";
  @property({ type: String }) display = "";
  @property({ type: Boolean }) easter = false;
  @property({ type: Boolean }) allowModifiers = false;

  createRenderRoot() {
    return this;
  }

  private listening = false;

  render() {
    const currentValue = this.value === "" ? "" : this.value || this.defaultKey;
    const canReset = this.value !== undefined && this.value !== this.defaultKey;
    const displayValue = this.display || currentValue;
    const shown = this.listening ? "…" : this.displayKey(displayValue);
    const unbound = !displayValue || displayValue === "Null";

    // KeyBindRow: the action left, its KeyCap right, then reset and unbind.
    return html`
      <div class="zf-row" title=${ifDefined(this.description || undefined)}>
        <span class="zf-row-label">
          ${this.label}
          ${
            this.description
              ? html`<span class="zf-sr-only">${this.description}</span>`
              : nothing
          }
        </span>
        <span class="zf-row-end">
          <span class="zf-ring">
            <div
              class="zf-keybind-cap zf-frame zf-sweep"
              role="button"
              dir="ltr"
              aria-label="${this.label}: ${shown}"
              title=${translateText("user_setting.press_a_key")}
              tabindex="0"
              ?data-listening=${this.listening}
              ?data-unbound=${unbound && !this.listening}
              @keydown=${this.handleKeydown}
              @click=${this.startListening}
              @blur=${this.handleBlur}
            >
              ${shown}
            </div>
          </span>
          <span class="zf-ring">
            <button
              type="button"
              class="zf-icon-btn zf-frame zf-sweep"
              aria-label=${translateText("user_setting.reset")}
              title=${translateText("user_setting.reset")}
              @click=${this.resetToDefault}
              ?disabled=${!canReset}
            >
              ${zfIcon("reset", 18, 3)}
            </button>
          </span>
          <span class="zf-ring">
            <button
              type="button"
              class="zf-icon-btn zf-icon-btn-danger zf-frame zf-sweep"
              aria-label=${translateText("user_setting.unbind")}
              title=${translateText("user_setting.unbind")}
              @click=${this.unbindKey}
            >
              ${zfIcon("unlink", 18, 3)}
            </button>
          </span>
        </span>
      </div>
    `;
  }

  private displayKey(key: string): string {
    if (!key || key === "Null") return translateText("common.none");
    return formatKeyForDisplay(key);
  }

  private startListening() {
    this.listening = true;
    this.requestUpdate();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.listening) return;

    if (e.key === "Escape") {
      // Cancel listening on Escape without bubbling to close parent modals
      e.preventDefault();
      e.stopPropagation();
      this.listening = false;
      this.requestUpdate();
      return;
    }

    // Allow Tab to work normally (don't trap focus)
    if (e.key === "Tab") {
      return;
    }

    const isModifier =
      e.code === "ShiftLeft" ||
      e.code === "ShiftRight" ||
      e.code === "ControlLeft" ||
      e.code === "ControlRight" ||
      e.code === "AltLeft" ||
      e.code === "AltRight" ||
      e.code === "MetaLeft" ||
      e.code === "MetaRight";

    if (isModifier && !this.allowModifiers) {
      return;
    }

    // Prevent default only for keys we're actually capturing
    e.preventDefault();

    const code = isModifier ? e.code : e.shiftKey ? `Shift+${e.code}` : e.code;
    const displayKey = isModifier
      ? e.code
      : e.shiftKey
        ? `Shift+${e.key.toUpperCase()}`
        : e.key;
    const prevValue = this.value;

    // Temporarily set the value to the new code for validation in parent
    this.value = code;

    const event = new CustomEvent("change", {
      detail: { action: this.action, value: code, key: displayKey, prevValue },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);

    // If parent rejects (restores value), this.value will be set back externally
    // Otherwise, keep the new value
    this.listening = false;
    this.requestUpdate();
  }

  private handleBlur() {
    this.listening = false;
    this.requestUpdate();
  }

  private resetToDefault() {
    this.value = this.defaultKey;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value: this.defaultKey,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private unbindKey() {
    this.value = "Null";
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value: "Null",
          key: "",
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }
}
