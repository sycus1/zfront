import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import { modalRouter } from "../ModalRouter";
import { translateText } from "../Utils";
import "./baseComponents/Modal";
import type { OModal } from "./baseComponents/Modal";
import "./ConfirmDialog";
import {
  type TabDef,
  zfBackButton,
  zfMapBackdrop,
  zfPageHeader,
  zfPageTitle,
  zfTabs,
} from "./nightshift/Primitives";

export type OModalTab = TabDef;

/**
 * Static-ish configuration for the page. Subclasses return a fresh object
 * from modalConfig(); avoid heavy work — it's read on every render() and
 * during open()/setActiveTab().
 */
export interface ModalConfig {
  tabs?: OModalTab[];
}

/** The map behind a menu page that has no map of its own. */
const DEFAULT_BACKDROP = "images/maps/bath.png";

interface PendingConfirm {
  heading: string;
  message: string;
  confirmText: string;
  variant: "danger" | "warning";
  resolve: (ok: boolean) => void;
}

/**
 * Base class for modal components.
 *
 * BaseModal draws the Night Shift page itself: back button, stencil title,
 * tabs, the body and the page's actions. Subclasses provide pageTitle(),
 * renderBody(tab) and optionally renderTitleAside() / renderActions(), and
 * declare their tabs via modalConfig().
 *
 * An `inline` page fills the menu's content area (.zf-page over a map
 * backdrop); otherwise — the in-game copy of Settings — the same page sits
 * in an <o-modal> panel over the game.
 *
 * Lifecycle:
 *   open(args?)  → onOpen(args) hook → shell visible
 *   close(args?) → onClose(args) hook → shell hidden
 *
 * Tabs (optional):
 *   Return a non-empty tabs[] from modalConfig(). BaseModal owns activeTab
 *   state, draws the tabs beside the title and dispatches rendering to
 *   renderBody(key). Subclasses can opt in
 *   to onTabEnter(key) for per-tab lifecycle (e.g. lazy load).
 */
export abstract class BaseModal extends LitElement {
  @state() protected isModalOpen = false;
  @state() protected activeTab = "";
  @property({ type: Boolean }) inline = false;

  // Pending confirmation; when set, renders the confirm dialog.
  @state() private pendingConfirm: PendingConfirm | null = null;

  // Re-entrancy guard: showPage() (for inline modals) re-invokes .open()
  // with no args after we call it. We must not re-run onOpen(undefined)
  // from that nested call, which would clobber state set by the outer call.
  private opening = false;

  @query("o-modal") protected modalEl?: OModal;

  // ---- Subclass configuration ----

  protected modalConfig(): ModalConfig {
    return {};
  }

  /**
   * Optional router name. When set, BaseModal syncs URL state on open/close/
   * tab change as `#modal=<routerName>&tab=<key>&...`. Modals that own their
   * own URL state (e.g. lobby modals) should leave this undefined.
   */
  protected routerName?: string;

  /** The page title, in stencil capitals. */
  protected pageTitle(): string {
    return "";
  }

  /** Where the back button goes, in capitals beside its arrow. */
  protected backLabel(): string {
    return this.inline
      ? translateText("zf_play.back_menu")
      : translateText("common.back");
  }

  /** Beside the title on a page without tabs (e.g. a COPY button). */
  protected renderTitleAside(): TemplateResult | typeof nothing {
    return nothing;
  }

  /** The end of the page, under the body (e.g. Settings' DONE strip). */
  protected renderActions(): TemplateResult | typeof nothing {
    return nothing;
  }

  /** The map behind an inline page. */
  protected backdropImage(): string {
    return assetUrl(DEFAULT_BACKDROP);
  }

  /**
   * Render the modal body. For tabbed modals, switch on `tab` to render the
   * appropriate panel. Modals without tabs can ignore the argument.
   */
  protected renderBody(_tab: string): TemplateResult {
    return html``;
  }

  // ---- Lifecycle hooks ----

  /** Called when the modal opens. Receives router args / direct-caller args. */
  protected onOpen(_args?: Record<string, unknown>): void {}

  /** Called when the modal closes. */
  protected onClose(_args?: Record<string, unknown>): void {}

  /** Called when the active tab changes (including initial set on open). */
  protected onTabEnter(_key: string): void {}

  /**
   * Guard called before closing via Escape key or click-outside.
   * Return false (or a promise resolving false) to prevent closing.
   */
  public confirmBeforeClose(): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Show a styled confirm dialog and resolve to the user's choice. Call from
   * confirmBeforeClose() to gate closing behind a confirm/cancel prompt.
   */
  protected confirmClose(message: string): Promise<boolean> {
    return this.askConfirm({ message, variant: "warning" });
  }

  /**
   * Ask before doing something that cannot be undone, e.g. a reset. Resolves
   * to the player's choice; a second prompt while one is open resolves false.
   */
  protected askConfirm(opts: {
    message: string;
    heading?: string;
    confirmText?: string;
    variant?: "danger" | "warning";
  }): Promise<boolean> {
    if (this.pendingConfirm) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.pendingConfirm = {
        heading: opts.heading ?? "",
        message: opts.message,
        confirmText: opts.confirmText ?? "",
        variant: opts.variant ?? "danger",
        resolve,
      };
    });
  }

  private settleConfirm(ok: boolean) {
    const pending = this.pendingConfirm;
    this.pendingConfirm = null;
    pending?.resolve(ok);
  }

  // ---- Rendering ----

  createRenderRoot() {
    return this;
  }

  protected willUpdate(): void {
    // Default the active tab so the highlight is correct on first render,
    // before open() runs (matters for inline modals rendered on page mount).
    const tabs = this.modalConfig().tabs ?? [];
    if (tabs.length && this.activeTab === "") {
      this.activeTab = tabs[0].key;
    }
  }

  /** A per-instance id prefix: Settings exists twice (page and in-game). */
  private idBase(): string {
    return this.id || this.localName;
  }

  private renderPage(): TemplateResult {
    const tabs = this.modalConfig().tabs ?? [];
    const base = this.idBase();
    const titleId = `${base}-title`;
    const panelId = `${base}-panel`;
    const tabbed = tabs.length > 1;
    const aside = this.renderTitleAside();
    return html`<div class="zf-page-inner">
      ${zfPageHeader(
        zfBackButton({
          label: this.backLabel(),
          onClick: () => this.close(),
        }),
      )}
      <div class="zf-page-head">
        ${zfPageTitle(titleId, this.pageTitle())}
        ${
          tabbed
            ? zfTabs({
                label: this.pageTitle(),
                tabs,
                active: this.activeTab,
                panelId,
                onSelect: (key) => this.setActiveTab(key),
              })
            : nothing
        }
        ${
          aside === nothing
            ? nothing
            : html`<div class="zf-page-head-aside">${aside}</div>`
        }
      </div>
      <div
        id=${panelId}
        class="zf-panel"
        role=${tabbed ? "tabpanel" : "group"}
        aria-labelledby=${tabbed ? `${panelId}-tab-${this.activeTab}` : titleId}
      >
        ${this.renderBody(this.activeTab)}
      </div>
      ${this.renderActions()}
    </div>`;
  }

  render(): TemplateResult {
    const page = this.renderPage();
    const frame = this.inline
      ? html`<section class="zf-page" aria-labelledby="${this.idBase()}-title">
          ${zfMapBackdrop(this.backdropImage(), 0.8)} ${page}
        </section>`
      : html`<o-modal .label=${this.pageTitle()}>${page}</o-modal>`;
    return html`
      ${frame}
      ${
        this.pendingConfirm
          ? html`<confirm-dialog
              .heading=${this.pendingConfirm.heading}
              .message=${this.pendingConfirm.message}
              .confirmText=${this.pendingConfirm.confirmText}
              .variant=${this.pendingConfirm.variant}
              @confirm=${() => this.settleConfirm(true)}
              @cancel=${() => this.settleConfirm(false)}
            ></confirm-dialog>`
          : null
      }
    `;
  }

  // ---- Open / close ----

  public isOpen(): boolean {
    return this.isModalOpen;
  }

  /**
   * Open the modal. `args` is a loose bag forwarded to onOpen(). The router
   * passes parsed URL params; direct callers can pass whatever they want.
   *
   * Recognized keys:
   *   - tab: string — sets active tab (validated against modalTabs)
   */
  public open(args?: Record<string, unknown>): void {
    if (this.opening) return;
    this.opening = true;
    try {
      const tabs = this.modalConfig().tabs ?? [];
      if (tabs.length && this.activeTab === "") {
        this.activeTab = tabs[0].key;
      }
      const requestedTab =
        typeof args?.tab === "string" && tabs.some((t) => t.key === args.tab)
          ? args.tab
          : null;

      const wasOpen = this.isModalOpen;
      if (!wasOpen) {
        if (requestedTab) this.activeTab = requestedTab;
        this.registerEscapeHandler();
        this.onOpen(args);
        if (this.activeTab) this.onTabEnter(this.activeTab);
      } else {
        this.onOpen(args);
        // Already open: route tab changes through setActiveTab so URL syncs.
        if (requestedTab && requestedTab !== this.activeTab) {
          this.setActiveTab(requestedTab);
        }
      }

      if (wasOpen) return;

      if (this.inline) {
        const needsShow =
          this.classList.contains("hidden") || this.style.display === "none";
        if (needsShow && window.showPage) {
          const pageId = this.id || this.tagName.toLowerCase();
          window.showPage?.(pageId);
        }
        this.style.pointerEvents = "auto";
      } else {
        this.modalEl?.open();
      }

      if (this.routerName) {
        modalRouter.syncOpened(this.routerName, args);
      }
    } finally {
      this.opening = false;
    }
  }

  public close(args?: Record<string, unknown>): void {
    // If closing was triggered elsewhere while a confirm prompt is pending,
    // dismiss it (removes the dialog and resolves the awaiting guard as false).
    this.settleConfirm(false);
    this.unregisterEscapeHandler();
    this.onClose(args);

    if (this.inline) {
      this.style.pointerEvents = "none";
      if (window.showPage) {
        window.showPage?.("page-play");
      }
    } else {
      this.modalEl?.close();
    }

    if (this.routerName) {
      modalRouter.syncClosed(this.routerName);
    }
  }

  // ---- Tab management ----

  /** Programmatically change the active tab. Triggers onTabEnter. */
  public setActiveTab(key: string): void {
    const tabs = this.modalConfig().tabs ?? [];
    if (!tabs.some((t) => t.key === key)) return;
    if (this.activeTab === key) return;
    this.activeTab = key;
    this.onTabEnter(key);
    if (this.routerName) {
      modalRouter.syncTab(this.routerName, key);
    }
  }

  // ---- Internals ----

  protected firstUpdated(): void {
    if (this.modalEl) {
      this.modalEl.onClose = async () => {
        if (this.isModalOpen) {
          const confirmed = await this.confirmBeforeClose();
          // Bail if a parallel close() settled things while we awaited —
          // otherwise we'd re-open an already-closed modal.
          if (!this.isModalOpen) return;
          if (!confirmed) {
            // Re-open the underlying o-modal since it already closed itself
            this.modalEl?.open();
            return;
          }
          this.close();
        }
      };
    }
  }

  disconnectedCallback() {
    this.settleConfirm(false);
    this.unregisterEscapeHandler();
    super.disconnectedCallback();
  }

  private handleKeyDown = async (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isModalOpen) {
      e.preventDefault();
      // Escape answers an open confirm prompt first.
      if (this.pendingConfirm) {
        this.settleConfirm(false);
        return;
      }
      const confirmed = await this.confirmBeforeClose();
      // Bail if a parallel close() already closed us while we awaited.
      if (!confirmed || !this.isModalOpen) {
        return;
      }
      this.close();
    }
  };

  protected registerEscapeHandler() {
    this.isModalOpen = true;
    window.addEventListener("keydown", this.handleKeyDown);
  }

  protected unregisterEscapeHandler() {
    this.isModalOpen = false;
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
