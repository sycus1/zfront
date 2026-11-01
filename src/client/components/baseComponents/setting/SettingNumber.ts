import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

let nextNumberId = 0;

/** A number setting (Night Shift row with a cream field in the data face). */
@customElement("setting-number")
export class SettingNumber extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Boolean }) easter = false;

  private readonly inputId = `zf-number-${nextNumberId++}`;

  createRenderRoot() {
    return this;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const newValue = Number(input.value);
    this.value = newValue;

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: newValue },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="zf-setting">
        <div class="zf-setting-text">
          <label class="zf-setting-label" for=${this.inputId}
            >${this.label}</label
          >
          ${
            this.description
              ? html`<span class="zf-setting-desc">${this.description}</span>`
              : nothing
          }
        </div>
        <input
          type="number"
          id=${this.inputId}
          class="zf-number"
          .value=${String(this.value ?? 0)}
          min=${this.min}
          max=${this.max}
          @input=${this.handleInput}
        />
      </div>
    `;
  }
}
