import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing, svg } from "lit";
import { customElement, state } from "lit/decorators.js";
import { zfIcon } from "../../components/nightshift/Icon";
import { Controller } from "../../Controller";
import { TogglePauseIntentEvent } from "../../InputHandler";
import { PauseGameIntentEvent, SendCallWaveIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  DIRECTIONS,
  fromEverySide,
  HQ_LOW_PERCENT,
  HQ_SEGMENTS,
  hqHit,
  hqPercent,
  hqSegments,
  padWave,
  formatCountdown,
  sectorDirections,
} from "../HordeHudModel";

export { formatCountdown };

/** How long HQ UNDER ATTACK stays up after the last hit, in ms. */
const HQ_ALERT_MS = 3000;

/**
 * zfront: the wave panel, top centre (the Night Shift "A2" HUD board). The
 * wave out of the total, zombies alive and the HQ's health; under them the
 * next wave's countdown, directions and size, with the button that calls it
 * early. While a wave is under way it shows how many are left to clear it;
 * after the clear, the build time left. HQ UNDER ATTACK shows under the
 * panel for a few seconds after each hit.
 *
 * Under 1024px it is the phone board's header instead: wave, HQ, gold and
 * pause across the top, and the next wave in a box below.
 */
@customElement("horde-hud")
export class HordeHud extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private status: HordeFrame | null = null;

  @state()
  private gold: bigint = 0n;

  @state()
  private hqAlert = false;

  @state()
  private paused = false;

  private lastHitAt = -Infinity;

  createRenderRoot() {
    return this;
  }

  init() {
    this.paused = this.game.resumedFromSave();
    this.eventBus.on(PauseGameIntentEvent, (e) => {
      this.paused = e.paused;
    });
  }

  tick() {
    if (!this.game?.config().gameConfig().horde) return;
    const next = this.game.hordeStatus();
    const now = performance.now();
    if (next !== null && hqHit(this.status, next)) this.lastHitAt = now;
    if (next !== this.status) this.status = next;
    this.hqAlert =
      next !== null &&
      next.outcome === "playing" &&
      now - this.lastHitAt < HQ_ALERT_MS;
    this.gold = this.game.myPlayer()?.gold() ?? 0n;
  }

  render() {
    const s = this.status;
    if (s === null) return nothing;
    return html`
      <div class="zf-wave" data-horde-hud>
        <section
          class="zf-wave-panel zf-hud zf-frame"
          aria-label=${translateText("horde_hud.wave_status")}
        >
          ${this.renderTop(s)} ${this.renderNextWave(s)}
        </section>
        ${this.hqAlert ? this.renderHqAlert() : nothing}
      </div>
    `;
  }

  private renderTop(s: HordeFrame) {
    const percent = hqPercent(s);
    const lit = hqSegments(percent);
    const endless = s.wavesToWin > 0 && s.wave > s.wavesToWin;
    return html`
      <div class="zf-wave-top">
        <div class="zf-wave-stat">
          <span class="zf-hud-label zf-hud-label-signal"
            >${translateText("horde_hud.wave")}</span
          >
          <span class="zf-num zf-wave-num" data-horde-wave translate="no"
            >${padWave(s.wave)}${
              endless
                ? html`<span class="zf-hud-muted">
                    ${translateText("horde_hud.endless")}</span
                  >`
                : s.wavesToWin > 0
                  ? html`<span class="zf-hud-muted"
                      >&nbsp;/ ${padWave(s.wavesToWin)}</span
                    >`
                  : nothing
            }</span
          >
        </div>
        <div class="zf-wave-stat zf-wave-alive-stat">
          <span class="zf-hud-label">${translateText("horde_hud.alive")}</span>
          <span class="zf-num zf-wave-alive" translate="no"
            >${renderNumber(s.alive)}</span
          >
        </div>
        <div class="zf-wave-stat zf-wave-hq">
          <span class="zf-hud-label"
            >${translateText("horde_hud.hq")}
            <span
              class="zf-num"
              style="letter-spacing: 0; color: var(--color-zf-cream-100)"
              data-horde-hq
              >${percent}%</span
            ></span
          >
          <span
            class="zf-hq-bar ${percent <= HQ_LOW_PERCENT ? "zf-hq-bar-low" : ""}"
            role="progressbar"
            aria-label=${translateText("horde_hud.hq_health")}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=${percent}
          >
            ${Array.from(
              { length: HQ_SEGMENTS },
              (_, i) => html`<span class=${i < lit ? "zf-on" : ""}></span>`,
            )}
          </span>
        </div>
        <div
          class="zf-wave-stat zf-wave-header-only"
          style="align-items: flex-end"
        >
          <span class="zf-hud-label">${translateText("horde_hud.gold")}</span>
          <span class="zf-num zf-wave-gold" translate="no"
            >${renderNumber(this.gold)}</span
          >
        </div>
        <span class="zf-ring zf-wave-header-only">
          <button
            type="button"
            class="zf-frame zf-sweep zf-hud-btn zf-wave-pause"
            aria-label=${translateText(
              this.paused ? "game_controls.resume" : "game_controls.pause",
            )}
            @click=${() => this.eventBus?.emit(new TogglePauseIntentEvent())}
          >
            ${zfIcon(this.paused ? "play" : "pause", 22)}
          </button>
        </span>
      </div>
    `;
  }

  private renderNextWave(s: HordeFrame) {
    if (s.outcome === "lost") return nothing;
    if (s.clearing) return this.renderClearing(s);
    if (s.nextWaveIn < 0) return nothing;
    const time = formatCountdown(s.nextWaveIn);
    if (s.nextWave === 0) {
      return html`<div class="zf-wave-next" data-horde-next>
        <span class="zf-wave-note">
          ${translateText("horde_hud.victory_in", { time })}
        </span>
      </div>`;
    }
    return html`
      <div class="zf-wave-next" data-horde-next>
        ${
          s.downtimeIn > 0
            ? html`<span class="zf-wave-note" data-horde-downtime>
                ${translateText("horde_hud.build_time", {
                  time: formatCountdown(s.downtimeIn),
                })}
              </span>`
            : nothing
        }
        ${this.renderWaveDetails(
          s,
          s.nextWaveFinal
            ? translateText("horde_hud.final_wave", { time })
            : translateText("horde_hud.next_wave", {
                wave: s.nextWave,
                time,
              }),
        )}
        ${
          s.canCallWave
            ? html`<span class="zf-ring">
                <button
                  type="button"
                  class="zf-frame zf-sweep zf-call-wave zf-stencil"
                  data-horde-call
                  @click=${() => this.eventBus?.emit(new SendCallWaveIntentEvent())}
                >
                  ${translateText("horde_hud.call_wave")}
                  <span class="zf-num" translate="no"
                    >${translateText("horde_hud.call_wave_gold", {
                      gold: renderNumber(s.callWaveGold),
                    })}</span
                  >
                </button>
              </span>`
            : nothing
        }
      </div>
    `;
  }

  /**
   * The wave under way still has to be cleared: how many are left, and the
   * next wave, which waits for the clear and the downtime after it.
   */
  private renderClearing(s: HordeFrame) {
    const count = renderNumber(s.clearLeft);
    if (s.nextWave === 0) {
      return html`<div class="zf-wave-next">
        <span class="zf-wave-note zf-wave-note-danger" data-horde-clearing>
          ${translateText("horde_hud.clear_to_win", { count })}
        </span>
      </div>`;
    }
    return html`
      <div class="zf-wave-next" data-horde-next>
        <span class="zf-wave-note" data-horde-clearing>
          ${translateText("horde_hud.clear_first", { count })}
        </span>
        ${this.renderWaveDetails(
          s,
          s.nextWaveFinal
            ? translateText("horde_hud.final_after_clear")
            : translateText("horde_hud.next_after_clear", {
                wave: s.nextWave,
              }),
        )}
      </div>
    `;
  }

  /** The announced wave: compass, heading, directions and size. */
  private renderWaveDetails(s: HordeFrame, heading: string) {
    const everySide = fromEverySide(s.nextWaveSectors, s.nextWaveFinal);
    const from = everySide
      ? translateText("horde_hud.from_everywhere")
      : translateText("horde_hud.from", {
          directions: sectorDirections(s.nextWaveSectors)
            .map((d) => translateText(`horde_direction.${d}`))
            .join(", "),
        });
    return html`
      <div class="zf-wave-row">
        ${this.renderCompass(everySide ? 0xff : s.nextWaveSectors, from)}
        <div class="zf-wave-stat">
          <span class="zf-hud-label">${translateText("horde_hud.next")}</span>
          <span
            class="zf-num zf-wave-when ${s.nextWaveFinal ? "zf-wave-final" : ""}"
            >${heading}</span
          >
        </div>
        <span class="zf-wave-from" data-horde-from>${from}</span>
        <span class="zf-num zf-wave-size">
          ${translateText("horde_hud.next_size", {
            count: renderNumber(s.nextWaveShamblers),
            elites: renderNumber(s.nextWaveElites),
          })}
        </span>
      </div>
    `;
  }

  /** Eight arrows round the HQ; the ones the wave comes from are red. */
  private renderCompass(mask: number, label: string) {
    return html`<svg
      width="40"
      height="40"
      viewBox="-20 -20 40 40"
      role="img"
      aria-label=${label}
      style="flex-shrink: 0"
    >
      ${DIRECTIONS.map(
        (_, k) =>
          svg`<polygon
            transform="rotate(${k * 45})"
            points="0,-17 -5,-7 5,-7"
            fill=${
              (mask & (1 << k)) !== 0
                ? "var(--color-zf-horde-300)"
                : "var(--color-zf-line-600)"
            }
          ></polygon>`,
      )}
      <rect
        x="-3"
        y="-3"
        width="6"
        height="6"
        fill="var(--color-zf-signal-400)"
      ></rect>
    </svg>`;
  }

  private renderHqAlert() {
    return html`<div
      role="alert"
      class="zf-hq-alert zf-hud zf-hud-danger zf-frame"
      data-horde-hq-alert
    >
      ${zfIcon("warning", 26, 2.8)}
      <span class="zf-stencil"
        >${translateText("horde_hud.hq_under_attack")}</span
      >
    </div>`;
  }
}
