import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import {
  zfAlert,
  zfButton,
  zfNote,
  zfTile,
} from "./components/nightshift/Primitives";
import {
  collectGraphicsDiagnostics,
  GraphicsDiagnostics,
} from "./utilities/Diagnostic";
import { translateText } from "./Utils";

@customElement("troubleshooting-modal")
export class TroubleshootingModal extends BaseModal {
  protected routerName = "troubleshooting";

  @property({ type: String }) markdown = "Loading...";

  @property({ type: Object })
  diagnostics?: GraphicsDiagnostics;

  @property({ type: Boolean }) loading = true;

  private initialized: boolean = false;

  private async loadDiagnostics() {
    const canvas = document.createElement("canvas");
    this.diagnostics = await collectGraphicsDiagnostics(canvas);
    this.loading = false;
    this.initialized = true;
  }

  protected pageTitle(): string {
    return translateText("troubleshooting.title");
  }

  /** Opened from Help, so its back button returns there. */
  protected backLabel(): string {
    return translateText("main.help");
  }

  protected renderTitleAside() {
    return zfButton({
      id: "troubleshooting-copy",
      label: translateText("troubleshooting.copy_diagnostics"),
      icon: "copy",
      variant: "outline-signal",
      disabled: this.loading,
      onClick: () => void this.copyDiagnostics(),
    });
  }

  protected renderBody() {
    if (this.loading) return html``;
    const d = this.diagnostics!;
    return html`
      ${zfAlert({
        title: translateText("troubleshooting.hardware_acceleration_title"),
        text: translateText("troubleshooting.hardware_acceleration_tip"),
      })}
      <div class="zf-panel-grid">
        ${this.section(
          translateText("troubleshooting.environment"),
          [
            [translateText("troubleshooting.browser"), d.browser.engine],
            [translateText("troubleshooting.platform"), d.browser.platform],
            [translateText("troubleshooting.os"), d.browser.os],
            [
              translateText("troubleshooting.device_pixel_ratio"),
              d.browser.dpr,
            ],
          ],
          translateText("troubleshooting.chromium_tip"),
        )}
        ${this.section(
          translateText("troubleshooting.rendering"),
          [
            [
              translateText("troubleshooting.renderer"),
              this.describeRenderer(d.rendering),
            ],
            [
              translateText("troubleshooting.max_texture_size"),
              d.rendering.maxTextureSize ??
                translateText("troubleshooting.unknown"),
            ],
            [
              translateText("troubleshooting.high_precision_shaders"),
              d.rendering.shaderHighp === true
                ? translateText("troubleshooting.yes")
                : translateText("troubleshooting.no"),
            ],
            [
              translateText("troubleshooting.gpu"),
              !d.rendering.gpu || d.rendering.gpu.unavailable
                ? translateText("troubleshooting.unavailable")
                : `${d.rendering.gpu.vendor} — ${d.rendering.gpu.renderer}`,
            ],
          ],
          translateText("troubleshooting.gpu_tip"),
        )}
        ${this.section(
          translateText("troubleshooting.power"),
          d.power.unavailable
            ? [
                [
                  translateText("troubleshooting.battery"),
                  translateText("troubleshooting.unavailable"),
                ],
              ]
            : [
                [
                  translateText("troubleshooting.charging"),
                  d.power.charging
                    ? translateText("troubleshooting.yes")
                    : translateText("troubleshooting.no"),
                ],
                [translateText("troubleshooting.battery_level"), d.power.level],
              ],
          translateText("troubleshooting.power_saving_tip"),
        )}
      </div>
    `;
  }

  /** A tile of label/value rows (values in the data face), then a tip. */
  private section(title: string, rows: [string, unknown][], tip: string) {
    return zfTile({
      title,
      body: html`<dl class="zf-data-rows">
          ${rows.map(
            ([label, value]) =>
              html`<div class="zf-data-row">
                <dt>${label}</dt>
                <dd dir="ltr">${value}</dd>
              </div>`,
          )}
        </dl>
        ${zfNote(tip)}`,
    });
  }

  protected onOpen(): void {
    if (!this.initialized) {
      this.initialized = true;
      this.loadDiagnostics();
    }
  }

  private async copyDiagnostics() {
    if (!this.diagnostics) return;
    const formatted =
      "```json\n" + JSON.stringify(this.diagnostics, null, 2) + "\n```";
    await navigator.clipboard.writeText(formatted);
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: html`${translateText("troubleshooting.copied_to_clipboard")}`,
          type: "info",
          duration: 3000,
        },
      }),
    );
  }

  private describeRenderer(rendering: any): string {
    if (rendering.gpu?.software) {
      return translateText("troubleshooting.software_rendering");
    }
    if (rendering.type === "Canvas2D") {
      return translateText("troubleshooting.canvas_2d_no_gpu");
    }
    return `${rendering.type}`;
  }

  public close(): void {
    // Override BaseModal.close() to navigate back to Help (this modal is
    // opened from inside HelpModal), not to page-play like other inline modals.
    // Main's game-start sweep closes it unopened; that must not reopen Help.
    const wasOpen = this.isOpen();
    this.unregisterEscapeHandler();
    this.onClose();
    if (this.inline) {
      this.style.pointerEvents = "none";
      if (wasOpen) window.showPage?.("page-help");
    } else {
      this.modalEl?.close();
    }
  }
}
