import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { SendCallWaveIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;

/** Ticks (10 per second) as m:ss. */
export function formatCountdown(ticks: number): string {
  const secs = Math.ceil(Math.max(0, ticks) / 10);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/**
 * zfront: the wave counter, HQ health bar and the next wave's countdown and
 * directions, top centre, with a button to call the next wave early once
 * the last one is cleared. Shown in horde games once the first wave timer
 * starts.
 */
@customElement("horde-hud")
export class HordeHud extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private status: HordeFrame | null = null;

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    if (!this.game?.config().gameConfig().horde) return;
    const next = this.game.hordeStatus();
    if (next !== this.status) this.status = next;
  }

  render() {
    const s = this.status;
    if (s === null) return nothing;
    const hqPercent =
      s.hqMaxHp > 0
        ? Math.max(0, Math.min(100, Math.round((s.hqHp / s.hqMaxHp) * 100)))
        : 0;
    const barColor =
      hqPercent > 50
        ? "bg-green-500"
        : hqPercent > 20
          ? "bg-yellow-400"
          : "bg-red-500";
    const wave =
      s.wavesToWin > 0 && s.wave > s.wavesToWin
        ? translateText("horde_hud.wave_endless", { wave: s.wave })
        : s.wavesToWin > 0
          ? translateText("horde_hud.wave_of", {
              wave: s.wave,
              total: s.wavesToWin,
            })
          : translateText("horde_hud.wave", { wave: s.wave });
    return html`
      <div
        class="fixed top-3 left-1/2 -translate-x-1/2 z-[1001] pointer-events-none select-none rounded-lg bg-gray-900/75 backdrop-blur-xs px-4 py-2 text-white shadow-lg w-[min(90vw,320px)]"
        data-horde-hud
      >
        <div class="flex items-baseline justify-between gap-3 text-sm">
          <span class="font-bold" data-horde-wave>${wave}</span>
          <span class="text-white/80">
            ${translateText("horde_hud.alive", {
              count: renderNumber(s.alive),
            })}
          </span>
        </div>
        <div class="mt-1.5 flex items-center gap-2 text-xs">
          <span class="font-semibold">${translateText("horde_hud.hq")}</span>
          <div
            class="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15"
            role="progressbar"
            aria-label=${translateText("horde_hud.hq")}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=${hqPercent}
          >
            <div
              class="h-full ${barColor} transition-[width] duration-300"
              style="width: ${hqPercent}%"
            ></div>
          </div>
          <span class="w-9 text-right tabular-nums" data-horde-hq
            >${hqPercent}%</span
          >
        </div>
        ${this.renderNextWave(s)}
      </div>
    `;
  }

  private renderNextWave(s: HordeFrame) {
    if (s.outcome === "lost" || s.nextWaveIn < 0) return nothing;
    const time = formatCountdown(s.nextWaveIn);
    if (s.nextWave === 0) {
      return html`<div class="mt-1.5 text-xs text-white/80" data-horde-next>
        ${translateText("horde_hud.victory_in", { time })}
      </div>`;
    }
    const directions = DIRECTIONS.filter(
      (_, k) => (s.nextWaveSectors & (1 << k)) !== 0,
    ).map((d) => translateText(`horde_direction.${d}`));
    const from =
      s.nextWaveFinal || directions.length === DIRECTIONS.length
        ? translateText("horde_hud.from_everywhere")
        : translateText("horde_hud.from", {
            directions: directions.join(", "),
          });
    return html`
      <div class="mt-1.5 text-xs" data-horde-next>
        <div class="flex items-baseline justify-between gap-3">
          <span class="font-semibold ${s.nextWaveFinal ? "text-red-300" : ""}">
            ${
              s.nextWaveFinal
                ? translateText("horde_hud.final_wave", { time })
                : translateText("horde_hud.next_wave", {
                    wave: s.nextWave,
                    time,
                  })
            }
          </span>
          <span class="text-white/80" data-horde-from>${from}</span>
        </div>
        <div class="text-white/60">
          ${translateText("horde_hud.next_size", {
            count: renderNumber(s.nextWaveShamblers),
            elites: renderNumber(s.nextWaveElites),
          })}
        </div>
        ${
          s.canCallWave
            ? html`<button
                class="pointer-events-auto mt-1.5 w-full rounded bg-red-700 px-2 py-1 font-semibold hover:bg-red-600"
                data-horde-call
                @click=${() => this.eventBus?.emit(new SendCallWaveIntentEvent())}
              >
                ${translateText("horde_hud.call_wave", {
                  gold: renderNumber(s.callWaveGold),
                })}
              </button>`
            : nothing
        }
      </div>
    `;
  }
}
