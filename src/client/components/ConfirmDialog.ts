import { html, LitElement, render as litRender, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../Utils";
import { zfIcon } from "./nightshift/Icon";

let nextDialogId = 0;

/**
 * A reusable inline confirmation / acknowledgement dialog (Night Shift): a
 * clipped, bordered card over a dark scrim. `danger` asks before something
 * destructive (red border and a red confirm); `warning` before anything
 * else (yellow).
 *
 * Usage:
 * ```html
 * <confirm-dialog
 *   .message=${"Are you sure?"}
 *   variant="danger"
 *   @confirm=${() => doThing()}
 *   @cancel=${() => {}}
 * ></confirm-dialog>
 * ```
 *
 * For ban-style flows, add a textarea:
 * ```html
 * <confirm-dialog
 *   .message=${"Ban this player?"}
 *   variant="warning"
 *   textareaPlaceholder="Reason (optional)"
 *   @confirm=${(e) => ban(e.detail.text)}
 *   @cancel=${() => {}}
 * ></confirm-dialog>
 * ```
 */
@customElement("confirm-dialog")
export class ConfirmDialog extends LitElement {
  @property() heading = "";
  @property() message = "";
  @property() variant: "danger" | "warning" = "danger";
  @property() textareaPlaceholder = "";
  @property() confirmText = "";
  @property() cancelText = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) showClose = false;
  @property({ type: Boolean }) wide = false;
  @property() buttons: "confirmCancel" | "confirmOnly" | "none" =
    "confirmCancel";

  @state() private text = "";

  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
  }

  render() {
    if (this.portal) {
      litRender(this.renderOverlay(), this.portal);
    }
    return html``;
  }

  private dialogId = `zf-dialog-${nextDialogId++}`;
  private focused = false;

  protected updated() {
    // Move focus into the dialog once, so keyboard players land on it.
    if (this.focused || !this.portal) return;
    const target =
      this.portal.querySelector<HTMLElement>("textarea") ??
      this.portal.querySelector<HTMLElement>(".zf-dialog-actions button");
    if (target) {
      this.focused = true;
      target.focus();
    }
  }

  private renderOverlay() {
    const isDanger = this.variant === "danger";
    const headingId = `${this.dialogId}-heading`;
    const messageId = `${this.dialogId}-message`;
    const button = (label: string, variant: string, onClick: () => void) =>
      html`<div class="zf-ring">
        <button
          type="button"
          class="zf-btn zf-btn-md zf-btn-${variant} zf-frame zf-sweep"
          ?disabled=${this.disabled}
          @click=${onClick}
        >
          ${label}
        </button>
      </div>`;

    return html`
      <div
        class="zf-dialog-scrim"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.handleCancel();
        }}
      >
        <div
          class="zf-dialog zf-frame ${this.wide ? "zf-dialog-wide" : ""} ${
            isDanger ? "zf-dialog-danger" : ""
          }"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby=${this.heading ? headingId : messageId}
          aria-describedby=${this.heading ? messageId : nothing}
        >
          ${
            this.showClose
              ? html`<div class="zf-dialog-close zf-ring">
                  <button
                    type="button"
                    class="zf-icon-btn zf-frame zf-sweep"
                    aria-label=${translateText("common.close")}
                    @click=${() => this.handleCancel()}
                  >
                    ${zfIcon("close", 18, 3)}
                  </button>
                </div>`
              : ""
          }
          ${
            this.heading
              ? html`<h2 id=${headingId} class="zf-dialog-title">
                  ${this.heading}
                </h2>`
              : ""
          }
          <!-- A property binding, so the template's own line breaks around
               it never reach pre-line. -->
          <p
            id=${messageId}
            class="zf-dialog-message"
            .textContent=${this.message}
          ></p>
          ${
            this.textareaPlaceholder
              ? html`<textarea
                  class="zf-dialog-text"
                  .value=${this.text}
                  @input=${(e: Event) =>
                    (this.text = (e.target as HTMLTextAreaElement).value)}
                  maxlength="200"
                  rows="2"
                  aria-label=${this.textareaPlaceholder}
                  placeholder="${this.textareaPlaceholder}"
                ></textarea>`
              : ""
          }
          ${
            this.buttons === "none"
              ? ""
              : html`<div class="zf-dialog-actions">
                  ${
                    this.buttons === "confirmCancel"
                      ? button(
                          this.cancelText || translateText("common.cancel"),
                          "outline",
                          () => this.handleCancel(),
                        )
                      : ""
                  }
                  ${button(
                    this.confirmText || translateText("common.confirm"),
                    isDanger ? "danger-solid" : "signal",
                    () => this.handleConfirm(),
                  )}
                </div>`
          }
        </div>
      </div>
    `;
  }

  private handleConfirm() {
    this.dispatchEvent(
      new CustomEvent("confirm", { detail: { text: this.text } }),
    );
    this.text = "";
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent("cancel"));
    this.text = "";
  }
}
