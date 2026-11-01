import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";

let nextSliderId = 0;

/**
 * A level (Night Shift Slider): label left, value right in the data face,
 * the range below in signal yellow. The description shows under the range,
 * or with `compact` only as a tooltip and for screen readers.
 */
@customElement("setting-slider")
export class SettingSlider extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  // Graphics options tune fractional values (opacities, scale factors), which
  // a whole-number slider cannot express.
  @property({ type: Number }) step = 1;
  @property({ type: Boolean }) easter = false;
  @property() unit = "%";
  @property({ attribute: false }) formatValue?: (value: number) => string;
  /** Description as a tooltip only, as on the Settings boards. */
  @property({ type: Boolean, reflect: true }) compact = false;

  private readonly inputId = `zf-slider-${nextSliderId++}`;

  createRenderRoot() {
    return this;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.value = Number(input.value);
    this.updateSliderStyle(input);

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private updateSliderStyle(slider: HTMLInputElement) {
    const percent = ((this.value - this.min) / (this.max - this.min)) * 100;
    const clamped = Math.max(0, Math.min(100, percent));
    slider.style.setProperty("--fill", `${clamped}%`);
  }

  /**
   * The filled part of the track is a CSS custom property, which `handleInput`
   * sets during a drag. Setting `.value` from outside — "Reset to defaults",
   * or reopening the tab — moves the thumb but left the fill where it was.
   */
  protected updated(changed: PropertyValues) {
    if (!changed.has("value") && !changed.has("min") && !changed.has("max")) {
      return;
    }
    const slider = this.renderRoot.querySelector(
      "input[type=range]",
    ) as HTMLInputElement | null;
    if (slider) this.updateSliderStyle(slider);
  }

  firstUpdated() {
    const slider = this.renderRoot.querySelector(
      "input[type=range]",
    ) as HTMLInputElement;
    if (slider) this.updateSliderStyle(slider);
  }

  render() {
    const descId = `${this.inputId}-desc`;
    const readout = this.formatValue
      ? this.formatValue(this.value)
      : `${this.value}${this.unit}`;
    return html`
      <div
        class="zf-slider"
        title=${ifDefined(
          this.compact && this.description ? this.description : undefined,
        )}
      >
        <div class="zf-slider-head">
          <label for=${this.inputId}>${this.label}</label>
          <span class="zf-slider-value" dir="ltr">${readout}</span>
        </div>
        <input
          type="range"
          id=${this.inputId}
          class="zf-range"
          min=${this.min}
          max=${this.max}
          step=${this.step}
          aria-describedby=${ifDefined(this.description ? descId : undefined)}
          .value=${String(this.value)}
          @input=${this.handleInput}
        />
        ${
          this.description
            ? html`<p
                id=${descId}
                class="zf-setting-desc ${this.compact ? "zf-sr-only" : ""}"
                style="margin: 0"
              >
                ${this.description}
              </p>`
            : nothing
        }
      </div>
    `;
  }
}
