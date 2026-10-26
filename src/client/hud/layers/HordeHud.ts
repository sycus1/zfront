import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/**
 * zfront: the wave counter and HQ health bar, top centre. Shown in horde
 * games once the first wave timer starts.
 */
@customElement("horde-hud")
export class HordeHud extends LitElement implements Controller {
  public game: GameView;

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
      s.wavesToWin > 0
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
      </div>
    `;
  }
}
