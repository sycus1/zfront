import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";

/**
 * An on/off setting (Night Shift). By default a row: label and description
 * left, the square switch right. With `chip` it is a SwitchChip: the label
 * and switch in a clipped chip, the description as a tooltip and for screen
 * readers. Either way the control is a real checkbox (role=switch), so
 * `change` bubbles from it as before.
 */
@customElement("setting-toggle")
export class SettingToggle extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean }) easter = false;
  /** Dependent settings use this while their parent setting is off. */
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Draw as a SwitchChip (for a tile of switches). */
  @property({ type: Boolean, reflect: true }) chip = false;

  createRenderRoot() {
    return this;
  }

  // `.checked` is a property binding, not `?checked`: once the player has
  // clicked the box, its dirty checkedness flag makes the attribute inert, so
  // an attribute binding could never un-check it again — "Reset to defaults"
  // would leave the box showing the old state.
  private handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.checked = input.checked;
  }

  private input() {
    return html`<input
      type="checkbox"
      role="switch"
      class="zf-sr-only"
      id=${this.id}
      .checked=${this.checked}
      ?disabled=${this.disabled}
      @change=${this.handleChange}
    />`;
  }

  private switchMark() {
    return html`<span class="zf-switch" aria-hidden="true"
      ><span></span
    ></span>`;
  }

  render() {
    if (this.chip) {
      return html`<div class="zf-ring">
        <label
          class="zf-chip zf-check zf-frame zf-sweep"
          title=${ifDefined(this.description || undefined)}
        >
          ${this.input()}
          <span>${this.label}</span>
          ${
            this.description
              ? html`<span class="zf-sr-only">${this.description}</span>`
              : nothing
          }
          ${this.switchMark()}
        </label>
      </div>`;
    }
    return html`<label class="zf-setting zf-check">
      ${this.input()}
      <span class="zf-setting-text">
        <span class="zf-setting-label">${this.label}</span>
        ${
          this.description
            ? html`<span class="zf-setting-desc">${this.description}</span>`
            : nothing
        }
      </span>
      ${this.switchMark()}
    </label>`;
  }
}
