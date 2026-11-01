import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { zfIcon } from "../../nightshift/Icon";

type SelectOption = {
  value: number | string;
  label: string;
};

let nextSelectId = 0;

/** A setting picked from a list (Night Shift row with a framed select). */
@customElement("setting-select")
export class SettingSelect extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Array }) options: SelectOption[] = [];
  @property({ type: String }) value = "";
  // Set while the value is owned by something the page has to wait for — the
  // Display tab uses it between sending a change to the desktop shell and the
  // shell reporting back, so a second change cannot be queued against a value
  // that is still settling.
  @property({ type: Boolean }) disabled = false;

  private readonly selectId = `zf-select-${nextSelectId++}`;

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const input = e.target as HTMLSelectElement;
    const selected = this.options.find(
      (option) => String(option.value) === input.value,
    );
    const selectedValue = selected?.value ?? input.value;
    this.value = String(selectedValue);

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: selectedValue },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="zf-setting">
        <div class="zf-setting-text">
          <label class="zf-setting-label" for=${this.selectId}
            >${this.label}</label
          >
          ${
            this.description
              ? html`<span class="zf-setting-desc">${this.description}</span>`
              : nothing
          }
        </div>
        <div class="zf-select-wrap">
          <select
            id=${this.selectId}
            class="zf-select"
            .value=${String(this.value)}
            ?disabled=${this.disabled}
            @change=${this.handleChange}
          >
            ${this.options.map(
              (option) =>
                html`<option
                  value=${String(option.value)}
                  ?selected=${String(option.value) === String(this.value)}
                >
                  ${option.label}
                </option>`,
            )}
          </select>
          ${zfIcon("chevron-down", 18, 3)}
        </div>
      </div>
    `;
  }
}
