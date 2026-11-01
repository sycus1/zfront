import { loadModal } from "./LazyModals";

export function initNavigation() {
  const showPage = (pageId: string) => {
    window.currentPageId = pageId;

    // Close the currently visible modal properly
    const visibleModal = document.querySelector(".page-content:not(.hidden)");
    if (visibleModal) {
      // If it's an open modal component, call close() for proper cleanup (onClose callback, etc.)
      if (
        typeof (visibleModal as any).isOpen === "function" &&
        (visibleModal as any).isOpen() &&
        typeof (visibleModal as any).close === "function"
      ) {
        (visibleModal as any).close();
      } else {
        visibleModal.classList.add("hidden");
        visibleModal.classList.remove("block");
      }
    }

    // Inline pages scroll inside their modal, not the document (see
    // styles.css). Set after closing the previous modal: an inline modal's
    // close() re-enters showPage("page-play"), which would clear this.
    document.body.classList.toggle("page-open", pageId !== "page-play");

    // Handle page-play separately (it's not a page-content element)
    const pagePlayEl = document.getElementById("page-play");
    if (pageId === "page-play") {
      pagePlayEl?.classList.remove("hidden");
    } else {
      pagePlayEl?.classList.add("hidden");
    }

    // Show the target page if it's a modal
    if (pageId !== "page-play") {
      const target = document.getElementById(pageId);
      if (target) {
        target.classList.remove("hidden");
        // Modals need block display explicitly
        if (target.classList.contains("page-content")) {
          target.classList.add("block");
        }

        // If the target itself is a modal component with inline attribute, open it
        if (target.hasAttribute("inline")) {
          if (typeof (target as any).open === "function") {
            (target as any).open();
          } else {
            // Its module hasn't loaded yet (see LazyModals): open it once it
            // has, unless the player has moved on by then. Leaving hides it.
            // (Not currentPageId: closing the previous page re-enters
            // showPage("page-play") after it was set.)
            const stillShown = () => !target.classList.contains("hidden");
            loadModal(target.localName).then(
              () => {
                if (stillShown()) (target as any).open?.();
              },
              (err) => {
                console.error(`${target.localName} failed to load:`, err);
                if (stillShown()) showPage("page-play");
              },
            );
          }
        }
      }
    }

    // Update active state on menu items
    document.querySelectorAll(".nav-menu-item").forEach((item) => {
      if ((item as HTMLElement).dataset.page === pageId) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    // Dispatch CustomEvent to notify listeners of page change
    window.dispatchEvent(new CustomEvent("showPage", { detail: pageId }));
  };

  window.showPage = showPage;

  // Use event delegation for navigation items (they may be inside Lit components)
  document.addEventListener("click", async (e) => {
    const target = (e.target as HTMLElement).closest(
      ".nav-menu-item[data-page]",
    );
    if (target) {
      const pageId = (target as HTMLElement).dataset.page;
      if (!pageId) return;

      // showPage() closes the currently visible modal, so respect its
      // close-confirmation guard first (e.g. the leave-lobby prompt).
      const visibleModal = document.querySelector(
        ".page-content:not(.hidden)",
      ) as any;
      if (
        visibleModal &&
        typeof visibleModal.isOpen === "function" &&
        visibleModal.isOpen() &&
        typeof visibleModal.confirmBeforeClose === "function" &&
        !(await visibleModal.confirmBeforeClose())
      ) {
        return;
      }

      showPage(pageId);
    }
  });

  // Ensure Play is the default visible/active page on load.
  showPage("page-play");
}
