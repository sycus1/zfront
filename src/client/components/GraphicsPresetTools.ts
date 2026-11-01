import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  migrateLegacyGraphicsSettings,
  parseGraphicsOverridesJson,
} from "../GraphicsPresets";
import { UserSettings } from "../UserSettings";
import { translateText } from "../Utils";
import { zfButton } from "./nightshift/Primitives";

/**
 * Save / copy / import for the whole graphics configuration.
 *
 * Sits at the top level of the Graphics tab, beside the preset picker rather
 * than inside the Advanced fold: saving what you just tuned is not itself a
 * tuning control, and a player who never expands Advanced should still find it.
 *
 * Self-contained like `graphics-preset-selector`: it reads and writes
 * `UserSettings` directly. A write to the graphics key is what a running game
 * follows, so an import applies live with no renderer reference here.
 */
@customElement("graphics-preset-tools")
export class GraphicsPresetTools extends LitElement {
  private readonly userSettings = new UserSettings();

  @state() private presetName = "";
  @state() private importText = "";
  @state() private importError = false;
  @state() private copiedJson = false;

  private copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Snapshot pre-preset custom settings before an import can overwrite them
    // wholesale. Idempotent, and a no-op once done.
    migrateLegacyGraphicsSettings(this.userSettings);
  }

  disconnectedCallback() {
    clearTimeout(this.copyResetTimer);
    super.disconnectedCallback();
  }

  private onPresetNameInput(event: Event) {
    this.presetName = (event.target as HTMLInputElement).value;
  }

  private onSavePreset() {
    const name = this.presetName.trim();
    if (!name) return;
    this.userSettings.setGraphicsPresets({
      ...this.userSettings.graphicsPresets(),
      [name]: this.userSettings.graphicsOverrides(),
    });
    this.presetName = "";
  }

  private async onCopyJson() {
    const json = JSON.stringify(this.userSettings.graphicsOverrides(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      return; // clipboard unavailable (permissions / insecure context)
    }
    this.copiedJson = true;
    clearTimeout(this.copyResetTimer);
    this.copyResetTimer = setTimeout(() => (this.copiedJson = false), 1500);
  }

  private onImportTextInput(event: Event) {
    this.importText = (event.target as HTMLTextAreaElement).value;
    this.importError = false;
  }

  private onImportApply() {
    // The text is whatever the player pasted, so the parse is guarded as well
    // as checked. Deeply nested input survives JSON.parse and the schema (which
    // strips what it does not know) only to overflow the stack in the
    // structural comparison behind it — a RangeError, not a parse failure.
    // Either way the answer to the player is the same: that is not settings
    // JSON.
    try {
      const parsed = parseGraphicsOverridesJson(this.importText);
      if (parsed === null) {
        this.importError = true;
        return;
      }
      this.userSettings.setGraphicsOverrides(parsed);
    } catch {
      this.importError = true;
      return;
    }
    this.importText = "";
  }

  render() {
    return html`
      <div class="zf-tools">
        <div class="zf-tools-row">
          <div class="zf-ring">
            <input
              type="text"
              id="graphics-preset-name"
              class="zf-field zf-frame"
              aria-label=${translateText(
                "graphics_setting.preset_name_placeholder",
              )}
              .value=${this.presetName}
              placeholder=${translateText(
                "graphics_setting.preset_name_placeholder",
              )}
              spellcheck="false"
              maxlength="40"
              @input=${this.onPresetNameInput}
            />
          </div>
          ${zfButton({
            id: "graphics-save-preset",
            label: translateText("graphics_setting.save_preset_label"),
            variant: "outline-signal",
            size: "sm",
            disabled: this.presetName.trim() === "",
            onClick: () => this.onSavePreset(),
          })}
        </div>

        <div class="zf-tools-row">
          <p class="zf-setting-desc" style="margin: 0; align-self: center">
            ${translateText("graphics_setting.copy_json_desc")}
          </p>
          ${zfButton({
            id: "graphics-copy-json",
            label: this.copiedJson
              ? translateText("common.copied")
              : translateText("graphics_setting.copy_json_label"),
            icon: this.copiedJson ? "check" : "copy",
            size: "sm",
            onClick: () => void this.onCopyJson(),
          })}
        </div>

        <div class="zf-text-field">
          <label for="graphics-import-json" class="zf-tools-label">
            ${translateText("graphics_setting.import_json_label")}
          </label>
          <span class="zf-setting-desc">
            ${translateText("graphics_setting.import_json_desc")}
          </span>
          <div class="zf-ring">
            <textarea
              id="graphics-import-json"
              class="zf-field zf-frame"
              rows="3"
              .value=${this.importText}
              spellcheck="false"
              aria-invalid=${this.importError ? "true" : "false"}
              @input=${this.onImportTextInput}
            ></textarea>
          </div>
          ${
            this.importError
              ? html`<div
                  id="graphics-import-error"
                  class="zf-field-error zf-frame"
                  role="alert"
                >
                  ${translateText("graphics_setting.import_json_invalid")}
                </div>`
              : nothing
          }
          <div style="display: flex">
            ${zfButton({
              id: "graphics-import-apply",
              label: translateText("graphics_setting.import_json_apply"),
              variant: "outline-signal",
              size: "sm",
              disabled: this.importText.trim() === "",
              onClick: () => this.onImportApply(),
            })}
          </div>
        </div>
      </div>
    `;
  }
}
