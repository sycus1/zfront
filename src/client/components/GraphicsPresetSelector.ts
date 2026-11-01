import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import {
  BUILTIN_PRESETS,
  migrateLegacyGraphicsSettings,
  stableStringify,
} from "../GraphicsPresets";
import { showInGameConfirm } from "../InGameModal";
import { type GraphicsOverrides } from "../render/gl";
import {
  GRAPHICS_KEY,
  GRAPHICS_PRESETS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../UserSettings";
import { translateText } from "../Utils";
import { zfIcon } from "./nightshift/Icon";

const CUSTOM_VALUE = "custom";

/**
 * Applies a graphics preset (built-ins + the player's saved ones) wholesale:
 * a Night Shift OptionGroup, one stencil radio per preset. Shows a checked
 * "Custom" entry while the current overrides match no preset, and a delete
 * button beside a saved preset while it is selected. Self-contained: reads/writes UserSettings directly and re-renders
 * on the settings-changed events, so hosts just drop the element in.
 */
@customElement("graphics-preset-selector")
export class GraphicsPresetSelector extends LitElement {
  private readonly userSettings = new UserSettings();

  // The option value the player last picked. Selection is otherwise derived
  // by content matching, which cannot tell apart presets with identical
  // overrides (e.g. a saved preset that duplicates a built-in) — without
  // this, such a preset could never show as selected, so its delete button
  // could never appear.
  @state()
  private lastSelected: string | null = null;

  createRenderRoot() {
    return this;
  }

  private readonly onSettingsChanged = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    for (const key of [GRAPHICS_KEY, GRAPHICS_PRESETS_KEY]) {
      globalThis.addEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        this.onSettingsChanged,
      );
    }
  }

  disconnectedCallback() {
    for (const key of [GRAPHICS_KEY, GRAPHICS_PRESETS_KEY]) {
      globalThis.removeEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        this.onSettingsChanged,
      );
    }
    super.disconnectedCallback();
  }

  private isActive(overrides: GraphicsOverrides): boolean {
    return (
      stableStringify(this.userSettings.graphicsOverrides()) ===
      stableStringify(overrides)
    );
  }

  private overridesForValue(value: string): GraphicsOverrides | undefined {
    const separator = value.indexOf(":");
    if (separator === -1) return undefined;
    const kind = value.slice(0, separator);
    const key = value.slice(separator + 1);
    return kind === "builtin"
      ? BUILTIN_PRESETS.find((p) => p.nameKey === key)?.overrides
      : this.userSettings.graphicsPresets()[key];
  }

  private selectedValue(): string {
    const last =
      this.lastSelected !== null
        ? this.overridesForValue(this.lastSelected)
        : undefined;
    if (last !== undefined && this.isActive(last)) {
      return this.lastSelected!;
    }
    const builtin = BUILTIN_PRESETS.find((p) => this.isActive(p.overrides));
    if (builtin !== undefined) return `builtin:${builtin.nameKey}`;
    const user = Object.entries(this.userSettings.graphicsPresets()).find(
      ([, overrides]) => this.isActive(overrides),
    );
    if (user !== undefined) return `user:${user[0]}`;
    return CUSTOM_VALUE;
  }

  private onSelect(value: string) {
    const overrides = this.overridesForValue(value);
    if (overrides !== undefined) {
      // Snapshot pre-preset custom settings before the first wholesale
      // overwrite — the in-game migration hasn't run yet if the player has
      // only used the main-menu selector.
      migrateLegacyGraphicsSettings(this.userSettings);
      this.lastSelected = value;
      this.userSettings.setGraphicsOverrides(overrides);
    }
  }

  private async onDelete() {
    const value = this.selectedValue();
    if (!value.startsWith("user:")) return;
    const name = value.slice("user:".length);
    const confirmed = await showInGameConfirm(
      translateText("graphics_setting.preset_delete_confirm", { name }),
    );
    if (!confirmed) return;
    const presets = { ...this.userSettings.graphicsPresets() };
    delete presets[name];
    this.userSettings.setGraphicsPresets(presets);
  }

  private option(value: string, label: string, title: string | undefined) {
    const on = this.selectedValue() === value;
    return html`<div class="zf-ring">
      <button
        type="button"
        role="radio"
        aria-checked=${on ? "true" : "false"}
        data-value=${value}
        title=${ifDefined(title)}
        class="zf-option zf-frame zf-sweep"
        @click=${() => this.onSelect(value)}
      >
        ${label}
      </button>
    </div>`;
  }

  render() {
    const selected = this.selectedValue();
    const userPresets = Object.keys(this.userSettings.graphicsPresets());
    // One stencil radio per preset. CUSTOM is shown, checked, only while the
    // overrides match no preset; it cannot be picked.
    return html`
      <div
        class="zf-preset-grid"
        role="radiogroup"
        aria-label=${translateText("user_setting.graphics_preset_label")}
      >
        ${BUILTIN_PRESETS.map((preset) =>
          this.option(
            `builtin:${preset.nameKey}`,
            translateText(preset.nameKey),
            translateText(preset.descKey),
          ),
        )}
        ${userPresets.map(
          (name) =>
            html`<div class="zf-preset-saved">
              ${this.option(`user:${name}`, name, undefined)}
              ${
                selected === `user:${name}`
                  ? html`<div class="zf-ring">
                      <button
                        type="button"
                        class="zf-icon-btn zf-icon-btn-danger zf-frame zf-sweep"
                        aria-label=${translateText(
                          "graphics_setting.preset_delete",
                          { name },
                        )}
                        title=${translateText(
                          "graphics_setting.preset_delete",
                          {
                            name,
                          },
                        )}
                        @click=${this.onDelete}
                      >
                        ${zfIcon("close", 18, 3)}
                      </button>
                    </div>`
                  : nothing
              }
            </div>`,
        )}
        ${
          selected === CUSTOM_VALUE
            ? html`<div class="zf-ring">
                <button
                  type="button"
                  role="radio"
                  aria-checked="true"
                  aria-disabled="true"
                  data-custom
                  class="zf-option zf-frame"
                >
                  ${translateText("graphics_setting.preset_custom")}
                </button>
              </div>`
            : nothing
        }
      </div>
    `;
  }
}
