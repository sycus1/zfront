import { EventBus } from "@openfront/shared/EventBus";
import { toWireGameStartInfo } from "@openfront/shared/SharedUtil";
import {
  GameInfo,
  GameRecord,
  PublicGameInfo,
  WireGameStartInfo,
} from "@openfront/shared/WireSchemas";
import type { JoinLobbyResult } from "./ClientGameRunner";
import { loadGameClient, prefetchGameClient } from "./GameClientLoader";
// The class is used as a type; retain this for registration.
// oxlint-disable-next-line import/no-duplicates -- Required custom-element registration.
import "./GameModeSelector";
import type { GameModeSelector } from "./GameModeSelector";
import { GameStartingModal } from "./GameStartingModal";
import type { HelpModal } from "./HelpModal";
import { showInGameConfirm } from "./InGameModal";
// The LangSelector class is used as a type; retain this for registration.
// oxlint-disable-next-line import/no-duplicates -- Required custom-element registration.
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { loadModal, prefetchModals, whenModalLoaded } from "./LazyModals";
import {
  hideMenuChrome,
  menuChromeIsTornDown,
  restoreMenuChrome,
} from "./MenuChrome";
import { modalRouter } from "./ModalRouter";
import { initNavigation } from "./Navigation";
import { capturePagePin } from "./PagePin";
import { fallbackPlayerName } from "./PlayerName";
import type { SinglePlayerModal } from "./SinglePlayerModal";
// Before the first userMeResponse, for the modals that load after it.
import "./UserMeBroadcast";
// The UsernameInput class is used as a type; retain this for registration.
// oxlint-disable-next-line import/no-duplicates -- Required custom-element registration.
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import { UserSettings } from "./UserSettings";
import {
  installCtrlWheelZoomBlocker,
  installDoubleTapZoomBlocker,
  installSafariPinchZoomBlocker,
} from "./utilities/DisableSafariPinchZoom";
import {
  currentPagePath,
  flushReloadToast,
  homeHref,
  incrementGamesPlayed,
  reloadForUpdate,
  translateText,
} from "./Utils";

import "./components/Footer";
import "./components/PlayPage";
import "./components/nightshift/LiveFeedBackdrop";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./styles.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";

declare global {
  interface Window {
    currentPageId?: string;
    showPage?: (pageId: string) => void;
  }

  // Extend the global interfaces to include your custom events
  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "game-starting": CustomEvent;
    "menu-restored": CustomEvent;
    "leave-lobby": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: WireGameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  // A singleplayer game resumed from a saved game: the uncompressed snapshot
  // the engine restores instead of starting fresh from gameStartInfo.
  snapshot?: Uint8Array;
  source?: "public" | "private" | "host" | "matchmaking" | "singleplayer";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
  // Watch without playing.
  spectator?: boolean;
}

/** Publishes "a match is running" to the `.in-game` body class. */
function setInGameSignal(inGame: boolean): void {
  document.body.classList.toggle("in-game", inGame);
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();

  private currentUrl: string | null = null;

  private usernameInput: UsernameInput | null = null;

  private gameModeSelector: GameModeSelector;
  private userSettings: UserSettings = new UserSettings();
  private mostRecentJoinEvent: number;

  /**
   * Whether the home page is currently torn down for a game. For listeners
   * that may not exist when "game-starting" fires (the menu audio chunk): the
   * event carries no history, so they cannot tell "no game yet" from "a game
   * started while I was loading". Cleared again on "menu-restored".
   */
  private menuTornDown = false;

  async initialize(): Promise<void> {
    // FIRST, ahead of every history write this client performs: a page served
    // under `/v/<commit>/` is pinned to that build. See PagePin.ts.
    capturePagePin();
    document.documentElement.style.setProperty(
      "--hud-opacity",
      String(this.userSettings.hudOpacity()),
    );

    flushReloadToast();

    // One mixer for the page: the menu theme here and the SoundManager a game
    // creates later both route through it, so the volume sliders reach both.
    // It and howler are their own chunk, so the page doesn't wait on them. A
    // game that got there first has made the mixer already, and the menu
    // theme has no business starting under it.
    Promise.all([
      import("./sound/AudioMixer"),
      import("./sound/MenuMusic"),
    ]).then(
      ([{ audioMixer, initAudioMixer }, { startMenuMusic }]) => {
        if (audioMixer() === null) {
          startMenuMusic(initAudioMixer(this.userSettings), {
            gameInProgress: this.menuTornDown,
          });
        }
      },
      (err) => console.error("Menu audio failed to load:", err),
    );

    // Register modals with the URL router.
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
    modalRouter.register("help", { tag: "help-modal", pageId: "page-help" });
    modalRouter.register("language", {
      tag: "language-modal",
      pageId: "page-language",
    });
    modalRouter.register("single-player", {
      tag: "single-player-modal",
      pageId: "page-single-player",
    });
    modalRouter.register("troubleshooting", {
      tag: "troubleshooting-modal",
      pageId: "page-troubleshooting",
    });

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    if (!langSelector) {
      console.warn("Lang selector element not found");
    }

    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      console.warn("Username input element not found");
    }

    this.gameModeSelector = document.querySelector(
      "game-mode-selector",
    ) as GameModeSelector;

    window.addEventListener("beforeunload", () => {
      if (this.lobbyHandle !== null) {
        // Leaving a game by navigating away tears the page down without ever
        // running handleLeaveLobby.
        setInGameSignal(false);
        this.lobbyHandle.stop(true);
      }
    });

    document.addEventListener("join-lobby", (event) => {
      void this.handleJoinLobby(event);
    });
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));

    const hlpModal = document.querySelector("help-modal") as HelpModal | null;
    if (!hlpModal) {
      console.warn("Help modal element not found");
    }
    const helpButton = document.getElementById("help-button");
    if (helpButton) {
      helpButton.addEventListener("click", () => {
        loadModal("help-modal").then(
          () => hlpModal?.open(),
          (err) => console.error("help-modal failed to load:", err),
        );
      });
    }
    // Tutorial entry points (play-page card, help page): a default solo game
    // with the guide on.
    document.addEventListener("start-tutorial", () => {
      // The help modal loads on demand (see LazyModals); until it has, it
      // can't be open.
      if (customElements.get("help-modal") && hlpModal?.isOpen()) {
        hlpModal.close();
      }
      if (this.usernameInput && !this.usernameInput.canPlay()) return;
      whenModalLoaded("single-player-modal", () => {
        void (
          document.querySelector("single-player-modal") as SinglePlayerModal
        )?.startTutorial();
      });
    });

    // Route the initial URL once the document is ready.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.handleUrl());
    } else {
      this.handleUrl();
    }

    const leaveGame = () => {
      window.location.href = homeHref();
    };

    const onHashUpdate = () => {
      // Router-managed hash changes (#modal=...) are handled by the router
      // syncing in/out.
      if (modalRouter.isHashRouted()) {
        modalRouter.routeFromHash();
        return;
      }
      this.handleUrl();
    };

    const onPopState = () => {
      if (this.currentUrl !== null && this.lobbyHandle !== null) {
        console.info("Game is active");

        if (!this.lobbyHandle.stop()) {
          console.info("Player is active, ask before leaving game");

          // We can't block navigation on an async confirmation, so restore the
          // history entry immediately and only leave once the player confirms.
          history.pushState(null, "", this.currentUrl);
          showInGameConfirm(translateText("help_modal.exit_confirmation")).then(
            (isConfirmed) => {
              if (isConfirmed) leaveGame();
            },
          );
          return;
        }

        console.info("Player is not active, leave the game immediately");

        leaveGame();
      } else {
        onHashUpdate();
      }
    };

    // Handle browser navigation (back/forward) and manual hash edits.
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashUpdate);

    function updateSliderProgress(slider: HTMLInputElement) {
      const percent =
        ((Number(slider.value) - Number(slider.min)) /
          (Number(slider.max) - Number(slider.min))) *
        100;
      slider.style.setProperty("--progress", `${percent}%`);
    }

    document
      .querySelectorAll<HTMLInputElement>("#bots-count")
      .forEach((slider) => {
        updateSliderProgress(slider);
        slider.addEventListener("input", () => updateSliderProgress(slider));
      });
  }

  /**
   * Close the menu's modals and hide its chrome, for a game at prestart.
   * Callers dispatch "game-starting" first, so the listeners that stay up
   * (menu music) stop too.
   */
  private closeMenu(): void {
    [
      "single-player-modal",
      "game-starting-modal",
      "game-top-bar",
      "help-modal",
      "user-setting",
      // The in-game instance is addressed by id: querySelector("user-setting")
      // above only ever reaches the page's inline one.
      "#game-settings",
      "troubleshooting-modal",
      "language-modal",
      "lang-selector",
    ].forEach((tag) => {
      const modal = document.querySelector(tag) as HTMLElement & {
        close?: () => void;
        isModalOpen?: boolean;
      };
      if (modal?.close) {
        modal.close();
      } else if (modal && "isModalOpen" in modal) {
        modal.isModalOpen = false;
      }
    });
    hideMenuChrome();
  }

  private handleUrl() {
    const decodedHash = decodeURIComponent(window.location.hash);
    if (modalRouter.routeFromPath()) {
      return;
    }
    if (modalRouter.routeFromHash()) {
      return;
    }
    if (decodedHash.startsWith("#refresh")) {
      window.location.href = homeHref();
    }
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    if (this.usernameInput && !this.usernameInput.canPlay()) {
      // The singleplayer modal shows the starting overlay before dispatching
      // join-lobby; a refused join must release it or it stays over the menu.
      const startingModal = document.querySelector("game-starting-modal");
      if (startingModal instanceof GameStartingModal) {
        startingModal.hide();
      }
      return;
    }
    this.mostRecentJoinEvent = event.timeStamp;

    console.log(`joining lobby ${lobby.gameID}`);

    if (this.lobbyHandle !== null) {
      console.log("joining lobby, stopping existing game");
      this.lobbyHandle.stop(true);
      setInGameSignal(false);
    }

    // Ensure the one-shot name-seed has settled before reading the name. It
    // always resolves (falling back to the generated anon name), so this can
    // only delay, never block.
    await this.usernameInput?.whenSeeded();
    const resolvedName =
      this.usernameInput?.resolvedName() ?? fallbackPlayerName();
    let joinLobby: typeof import("./ClientGameRunner").joinLobby;
    try {
      ({ joinLobby } = await loadGameClient());
    } catch (err) {
      // The game's chunk didn't load (a network error, or a deploy that
      // replaced it). A full page load also picks up a new deploy, unless the
      // player has since left or started another join.
      console.error("game client failed to load:", err);
      if (this.mostRecentJoinEvent !== event.timeStamp) return;
      history.replaceState(null, "", "/");
      reloadForUpdate();
      return;
    }
    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: {},
      turnstileToken: null,
      playerName: resolvedName.name,
      playerRole: null,
      gameStartInfo:
        lobby.gameStartInfo ??
        // Replays simulate from the archived record; re-apply the server's
        // wire blanking or team games desync (see toWireGameStartInfo).
        (lobby.gameRecord
          ? toWireGameStartInfo(lobby.gameRecord.info)
          : undefined),
      gameRecord: lobby.gameRecord,
      snapshot: lobby.snapshot,
      spectator: lobby.spectator,
    });

    if (this.mostRecentJoinEvent !== event.timeStamp) {
      newLobbyHandle.stop(true);
      console.warn("Join requested, but was superseded");
      return;
    }

    this.lobbyHandle = newLobbyHandle;

    this.lobbyHandle.prestart.then(() => {
      // The game is actually starting now. Let listeners that stay up through
      // the wait hide at this point instead of on join.
      this.menuTornDown = true;
      document.dispatchEvent(new CustomEvent("game-starting"));
      console.log("Closing modals");
      if (this.usernameInput) {
        // fix edge case where username-validation-error is re-rendered and hidden tag removed
        this.usernameInput.validationError = "";
      }
      document
        .getElementById("username-validation-error")
        ?.classList.add("hidden");
      this.closeMenu();

      // show when the game loads
      const startingModal = document.querySelector(
        "game-starting-modal",
      ) as GameStartingModal;
      if (startingModal && startingModal instanceof GameStartingModal) {
        startingModal.show();
      }
    });

    this.lobbyHandle.join.then(() => {
      incrementGamesPlayed();

      hideMenuChrome();
      setInGameSignal(true);

      const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
      // Ensure there's a homepage entry in history before adding the game entry
      if (window.location.hash === "" || window.location.hash === "#") {
        history.replaceState(null, "", window.location.origin + "#refresh");
      }
      history.pushState(
        null,
        "",
        currentPagePath(
          lobbyIdHidden ? "/streamer-mode" : `/game/${lobby.gameID}?live`,
        ),
      );

      // Store current URL for popstate confirmation
      this.currentUrl = window.location.href;
    });
  }

  private async handleLeaveLobby() {
    // Supersede whatever join is still in flight: bumping the timestamp makes
    // that join take the superseded branch above and stop itself.
    this.mostRecentJoinEvent = performance.now();

    if (this.lobbyHandle === null) {
      return;
    }
    console.log("leaving lobby, cancelling game");
    this.lobbyHandle.stop(true);
    this.lobbyHandle = null;
    this.currentUrl = null;

    try {
      history.replaceState(null, "", "/");
    } catch (e) {
      console.warn("Failed to restore URL on leave:", e);
    }

    setInGameSignal(false);

    // The gate asks whether the chrome is torn down, NOT whether we were
    // in-game: the teardown happens at prestart while the in-game signal is
    // only set at join.
    if (menuChromeIsTornDown()) {
      restoreMenuChrome();
      // The counterpart to "game-starting": MenuMusic tore its gesture
      // listeners down at prestart and needs them back.
      this.menuTornDown = false;
      document.dispatchEvent(new CustomEvent("menu-restored"));
    }
  }
}

// Initialize the client when the DOM is loaded
const bootstrap = () => {
  // Prevent Safari's page-level pinch-zoom, which ignores `user-scalable=no`
  // on iOS and can softlock the HUD. See issue #2330.
  installSafariPinchZoomBlocker();

  // Same for double-tap "smart zoom", which `touch-action: manipulation`
  // alone does not reliably stop on iOS. See issue #4609.
  installDoubleTapZoomBlocker();

  // Chrome and Firefox report a trackpad pinch as ctrl+wheel, which only the
  // map canvas cancels — so pinching over a HUD panel zoomed the page instead
  // of the map. See issue #5098.
  installCtrlWheelZoomBlocker();

  new Client().initialize();
  initNavigation();
  prefetchGameClient();
  prefetchModals();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
