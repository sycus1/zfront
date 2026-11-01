import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "../../components/DoomsdayClockPanel";
import { zfIcon } from "../../components/nightshift/Icon";
import "../../components/OvertimePanel";
import { Controller } from "../../Controller";
import { showInGameConfirm } from "../../InGameModal";
import {
  ReplaySpeedChangeEvent,
  TogglePauseIntentEvent,
} from "../../InputHandler";
import { PauseGameIntentEvent, SendWinnerEvent } from "../../Transport";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";
import { homeHref, showToast, translateText } from "../../Utils";
import { GameView } from "../../view";
import { ShowReplayPanelEvent, speedLabel } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";

const LAST_MINUTE_SECONDS = 60;
const FLASH_TIMER_SECONDS = 30;
const FLASH_SIDEBAR_SECONDS = 10;
const ONE_MINUTE_WARNING_DURATION_MS = 4_000;

@customElement("game-right-sidebar")
export class GameRightSidebar extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private _isSinglePlayer: boolean = false;

  @state()
  private _isReplayVisible: boolean = false;

  @state()
  private _isVisible: boolean = true;

  @state()
  private isPaused: boolean = false;

  @state()
  private isFullscreen: boolean = false;

  @state()
  private timer: number = 0;

  @state()
  private speed: ReplaySpeedMultiplier = defaultReplaySpeedMultiplier;

  private readonly hideFullscreenButton = false;
  private hasWinner = false;
  private isLobbyCreator = false;
  private isPrivateLobby = false;
  private hasShownOneMinuteWarning = false;

  createRenderRoot() {
    // The control group, with the end-game mode readouts stacked above it.
    this.style.display = "flex";
    this.style.flexDirection = "column-reverse";
    this.style.alignItems = "flex-end";
    this.style.gap = "6px";
    return this;
  }

  init() {
    this._isSinglePlayer =
      this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this.isPrivateLobby =
      this.game?.config()?.gameConfig()?.gameType === GameType.Private;
    this._isVisible = true;
    this.hasShownOneMinuteWarning = false;
    // LocalServer opens a resumed game paused.
    this.isPaused = this.game.resumedFromSave();

    this.eventBus.on(ReplaySpeedChangeEvent, (e) => {
      this.speed = e.replaySpeedMultiplier;
    });

    this.eventBus.on(SendWinnerEvent, () => {
      this.hasWinner = true;
      this.requestUpdate();
    });

    this.eventBus.on(TogglePauseIntentEvent, () => {
      const isReplayOrSingleplayer =
        this._isSinglePlayer || this.game?.config()?.isReplay();
      if (
        isReplayOrSingleplayer ||
        (this.isLobbyCreator && !this.game.config().listed)
      ) {
        this.onPauseButtonClick();
      }
    });

    this.requestUpdate();
  }

  private onFullscreenChange = () => {
    this.isFullscreen = !!document.fullscreenElement;
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    this.onFullscreenChange();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    // Timer logic
    // Check if the player is the lobby creator
    if (!this.isLobbyCreator && this.game.myPlayer()?.isLobbyCreator()) {
      this.isLobbyCreator = true;
      this.requestUpdate();
    }

    if (this.game.inSpawnPhase()) {
      // Singleplayer has no spawn timer (SpawnTimerExecution isn't added), so
      // the spawn phase doesn't count down — keep the old static display.
      if (this.game.config().gameConfig().gameType === GameType.Singleplayer) {
        const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
        this.timer =
          maxTimerValue !== null && maxTimerValue !== undefined
            ? maxTimerValue * 60
            : 0;
        return;
      }
      const spawnPhaseDurationTicks = this.game.config().numSpawnPhaseTurns();
      const currentTicks = this.game.ticks();
      const remainingTicks = spawnPhaseDurationTicks - currentTicks;
      const remainingSeconds = Math.ceil(remainingTicks / 10);
      this.timer = Math.max(0, remainingSeconds);
      return;
    }

    const elapsedSeconds = Math.floor(this.game.elapsedGameSeconds());

    // zfront: a won horde game can be played on, so its clock keeps going.
    if (this.hasWinner && this.game.config().gameConfig().horde !== true) {
      return;
    }

    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    if (maxTimerValue !== null && maxTimerValue !== undefined) {
      this.timer = Math.max(0, maxTimerValue * 60 - elapsedSeconds);
      this.maybeShowOneMinuteWarning();
    } else {
      this.timer = elapsedSeconds;
    }
  }

  // Handing the notice to the heads-up toast layer means that layer owns the
  // dismissal timer, so there's nothing for us to tear down on disconnect or
  // when the game ends.
  private maybeShowOneMinuteWarning(): void {
    if (
      !this.hasWinner &&
      !this.game.inSpawnPhase() &&
      this.timer > 0 &&
      this.timer <= LAST_MINUTE_SECONDS &&
      !this.hasShownOneMinuteWarning
    ) {
      this.hasShownOneMinuteWarning = true;
      showToast(
        translateText("game_timer.one_minute_remaining"),
        "red",
        ONE_MINUTE_WARNING_DURATION_MS,
      );
    }
  }

  private secondsToHms = (d: number): string => {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);

    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);

    if (h !== 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    } else {
      return `${pad(m)}:${pad(s)}`;
    }
  };

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
    this.eventBus.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    this.eventBus.emit(new PauseGameIntentEvent(this.isPaused));
  }

  private async onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = await showInGameConfirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    // redirect to the home page
    window.location.href = homeHref();
  }

  private onSettingsButtonClick() {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
  }

  private onFullscreenButtonClick() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Failed to enter fullscreen:", err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Failed to exit fullscreen:", err);
      });
    }
  }

  render() {
    if (this.game === undefined) return html``;

    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    const isEndTimerActive =
      maxTimerValue !== undefined &&
      maxTimerValue !== null &&
      !this.game.inSpawnPhase() &&
      !this.hasWinner &&
      this.timer > 0;
    const isLastMinute = isEndTimerActive && this.timer <= LAST_MINUTE_SECONDS;
    const shouldFlashTimer =
      isEndTimerActive && this.timer <= FLASH_TIMER_SECONDS;
    const shouldFlashSidebar =
      isEndTimerActive && this.timer <= FLASH_SIDEBAR_SECONDS;

    const timerClass = shouldFlashTimer
      ? "game-end-timer-flash"
      : isLastMinute
        ? "game-end-timer-last-minute"
        : "";

    return html`
      <style>
        @keyframes game-end-timer-sidebar-flash {
          0%,
          100% {
            --zf-fill: rgb(17 17 17 / 0.9);
          }
          50% {
            --zf-fill: var(--color-zf-horde-500);
          }
        }
        .game-end-timer-last-minute,
        .game-end-timer-flash {
          --zf-border: var(--color-zf-horde-500);
          color: var(--color-zf-horde-300);
        }
        .game-end-timer-sidebar-flash .zf-hud-timer {
          animation: game-end-timer-sidebar-flash 1s steps(1) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .game-end-timer-sidebar-flash .zf-hud-timer {
            animation: none;
            --zf-fill: var(--color-zf-horde-500);
          }
        }
      </style>
      <aside
        class=${`zf-hud-controls ${shouldFlashSidebar ? "game-end-timer-sidebar-flash" : ""} ${
          this._isVisible ? "" : "hidden"
        }`}
        aria-label=${translateText("game_controls.label")}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <span
          class="zf-hud zf-hud-sm zf-frame zf-num zf-hud-timer ${timerClass}"
          data-game-timer
          role="timer"
          >${this.secondsToHms(this.timer)}</span
        >
        ${this.maybeRenderReplayButtons()}
        ${this.controlButton(
          translateText("game_controls.settings"),
          zfIcon("gear", 24),
          this.onSettingsButtonClick,
        )}
        ${
          document.fullscreenEnabled && !this.hideFullscreenButton
            ? this.controlButton(
                this.isFullscreen
                  ? translateText("fullscreen.exit")
                  : translateText("fullscreen.enter"),
                zfIcon(
                  this.isFullscreen ? "fullscreen-exit" : "fullscreen",
                  24,
                ),
                this.onFullscreenButtonClick,
              )
            : nothing
        }
        ${this.controlButton(
          translateText("game_controls.exit"),
          zfIcon("exit", 24),
          this.onExitButtonClick,
        )}
      </aside>
      <doomsday-clock-panel
        .game=${this.game}
        .hasWinner=${this.hasWinner}
        .refreshKey=${this.timer}
      ></doomsday-clock-panel>
      <overtime-panel
        .game=${this.game}
        .hasWinner=${this.hasWinner}
        .refreshKey=${this.timer}
      ></overtime-panel>
    `;
  }

  private controlButton(
    label: string,
    content: unknown,
    onClick: () => void,
    opts: { pressed?: boolean; className?: string; wide?: boolean } = {},
  ) {
    return html`<span class="zf-ring ${opts.className ?? ""}">
      <button
        type="button"
        class="zf-frame zf-sweep zf-hud-btn ${opts.wide ? "zf-hud-btn-wide zf-num" : ""}"
        aria-label=${label}
        aria-pressed=${opts.pressed === undefined ? nothing : String(opts.pressed)}
        @click=${() => onClick.call(this)}
      >
        ${content}
      </button>
    </span>`;
  }

  maybeRenderReplayButtons() {
    const isReplayOrSingleplayer =
      this._isSinglePlayer || this.game?.config()?.isReplay();
    const showPauseButton =
      isReplayOrSingleplayer ||
      (this.isLobbyCreator && !this.game.config().listed);
    // zfront: on phone a horde game's header carries the pause button.
    const horde = this.game.config().gameConfig().horde === true;

    return html`
      ${
        showPauseButton
          ? this.controlButton(
              this.isPaused
                ? translateText("game_controls.resume")
                : translateText("game_controls.pause"),
              zfIcon(this.isPaused ? "play" : "pause", 24),
              this.onPauseButtonClick,
              { className: horde ? "max-lg:hidden" : "" },
            )
          : nothing
      }
      ${
        isReplayOrSingleplayer
          ? this.controlButton(
              translateText("game_controls.speed", {
                speed: speedLabel(this.speed),
              }),
              speedLabel(this.speed),
              this.toggleReplayPanel,
              { pressed: this._isReplayVisible, wide: true },
            )
          : nothing
      }
    `;
  }
}
