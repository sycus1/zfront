import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { documentStylesSheet } from "./SharedStyles";

/**
 * The frame of a menu page opened over a running game (Night Shift): a dark
 * scrim and a yellow-bordered, clipped panel that scrolls inside. Full screen
 * below 1024px. The page (BaseModal) draws its own header, tabs and actions
 * inside; this only owns open/close, the click-outside and the body scroll
 * lock.
 *
 * A page shown in the menu's content area (`inline`) never renders one of
 * these: BaseModal draws it as a full-width .zf-page instead.
 */
@customElement("o-modal")
export class OModal extends LitElement {
  // The document's stylesheet, so the frame's .zf-* classes apply in here.
  static styles = [documentStylesSheet()];

  @state() public isModalOpen = false;

  @query("[data-modal-scroll]") private scrollContainer?: HTMLElement;

  static openCount = 0;

  /** Accessible name of the dialog. */
  @property({ type: String })
  public label = "";

  public onClose?: () => void;

  public open() {
    if (!this.isModalOpen) {
      OModal.openCount = OModal.openCount + 1;
      if (OModal.openCount === 1) document.body.style.overflow = "hidden";
      this.isModalOpen = true;
    }
  }

  public close() {
    if (this.isModalOpen) {
      this.isModalOpen = false;
      this.onClose?.();
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
    }
  }

  public getScrollTop(): number {
    return this.scrollContainer?.scrollTop ?? 0;
  }

  public setScrollTop(scrollTop: number): void {
    if (this.scrollContainer) {
      this.scrollContainer.scrollTop = scrollTop;
    }
  }

  disconnectedCallback() {
    // Ensure global counter is decremented if this modal is removed while open.
    if (this.isModalOpen) {
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
    }
    super.disconnectedCallback();
  }

  render() {
    if (!this.isModalOpen) return html``;
    return html`
      <div
        class="zf-overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div
          class="zf-overlay-panel zf-frame"
          role="dialog"
          aria-modal="true"
          aria-label=${this.label}
        >
          <div class="zf-overlay-scroll" data-modal-scroll><slot></slot></div>
        </div>
      </div>
    `;
  }
}
