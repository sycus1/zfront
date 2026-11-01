import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { ReplaySpeedChangeEvent } from "../../InputHandler";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

export class ShowReplayPanelEvent {
  constructor(
    public visible: boolean = true,
    public isSingleplayer: boolean = false,
  ) {}
}

@customElement("replay-panel")
export class ReplayPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @property({ type: Boolean })
  visible: boolean = false;

  @state()
  private _replaySpeedMultiplier: number = defaultReplaySpeedMultiplier;

  @property({ type: Boolean })
  isSingleplayer = false;

  createRenderRoot() {
    return this; // Enable Tailwind CSS
  }

  init() {
    if (this.eventBus) {
      this.eventBus.on(ShowReplayPanelEvent, (event: ShowReplayPanelEvent) => {
        this.visible = event.visible;
        this.isSingleplayer = event.isSingleplayer;
      });
      this.eventBus.on(
        ReplaySpeedChangeEvent,
        (event: ReplaySpeedChangeEvent) => {
          this._replaySpeedMultiplier = event.replaySpeedMultiplier;
          this.requestUpdate();
        },
      );
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    if (!this.visible) return;
    this.requestUpdate();
  }

  onReplaySpeedChange(value: ReplaySpeedMultiplier) {
    this._replaySpeedMultiplier = value;
    this.eventBus?.emit(new ReplaySpeedChangeEvent(value));
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div
        class="zf-speed-menu zf-hud zf-frame"
        role="group"
        aria-labelledby="zf-speed-title"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <span id="zf-speed-title" class="zf-hud-label" translate="no">
          ${
            this.game?.config()?.isReplay()
              ? translateText("replay_panel.replay_speed")
              : translateText("replay_panel.game_speed")
          }
        </span>
        <div class="zf-speed-options">
          ${this.renderSpeedButton(ReplaySpeedMultiplier.slow)}
          ${this.renderSpeedButton(ReplaySpeedMultiplier.normal)}
          ${this.renderSpeedButton(ReplaySpeedMultiplier.fast)}
          ${this.renderSpeedButton(ReplaySpeedMultiplier.fastest)}
        </div>
      </div>
    `;
  }

  private renderSpeedButton(value: ReplaySpeedMultiplier) {
    return html`
      <span class="zf-ring">
        <button
          type="button"
          class="zf-frame zf-sweep zf-num zf-speed-option"
          aria-pressed=${this._replaySpeedMultiplier === value ? "true" : "false"}
          @click=${() => this.onReplaySpeedChange(value)}
        >
          ${speedLabel(value)}
        </button>
      </span>
    `;
  }
}

/** A game speed as its button shows it: 0.5×, 1×, 2×, MAX. */
export function speedLabel(value: ReplaySpeedMultiplier): string {
  switch (value) {
    case ReplaySpeedMultiplier.slow:
      return "0.5×";
    case ReplaySpeedMultiplier.normal:
      return "1×";
    case ReplaySpeedMultiplier.fast:
      return "2×";
    case ReplaySpeedMultiplier.fastest:
      return translateText("replay_panel.fastest_game_speed");
  }
}
