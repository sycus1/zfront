import { Cell } from "@openfront/engine-api/game/GameTypes";
import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { Controller } from "../../../Controller";
import { GoToPositionEvent, TransformHandler } from "../../../TransformHandler";
import { translateText } from "../../../Utils";
import { GameView } from "../../../view";
import {
  CrateTarget,
  EdgeInsets,
  EdgeMarker,
  ScreenRect,
  crateTargets,
  edgeMarkers,
  hordeClusters,
  incomingTargets,
} from "./EdgeIndicators";

/** How far in from the screen edges the markers sit, in CSS pixels. */
const INSETS: EdgeInsets = { top: 30, right: 30, bottom: 30, left: 30 };
/** Tiles beyond which a marker is drawn at its faintest. */
const FAR_TILES = 160;
/** HUD panels the markers keep out of, and how often they are re-measured. */
const HUD_SELECTORS = [
  "game-left-sidebar aside",
  "game-right-sidebar",
  "[data-horde-hud]",
  "control-panel",
  "unit-display",
];
const HUD_MEASURE_MS = 500;

const COLORS = {
  horde: "220, 38, 38",
  incoming: "249, 115, 22",
  crate: "250, 204, 21",
} as const;

const STYLE = `
.horde-edge {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  pointer-events: none; will-change: transform;
}
.horde-edge-glow {
  position: absolute; border-radius: 9999px; pointer-events: none;
  transform: translate(-50%, -50%);
}
.horde-edge-badge {
  position: absolute; transform: translate(-50%, -50%);
  display: flex; align-items: center; justify-content: center;
  min-width: 30px; height: 22px; padding: 0 6px; border-radius: 9999px;
  font: 600 11px/1 system-ui, sans-serif; white-space: nowrap;
  background: currentColor; border: 1.5px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  pointer-events: auto; cursor: pointer; user-select: none;
}
.horde-edge-badge span { color: #fff; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5); }
.horde-edge.crate .horde-edge-badge span { color: #1f2937; text-shadow: none; }
.horde-edge-arrow {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  pointer-events: none;
}
.horde-edge-arrow::after {
  content: ""; position: absolute; left: 17px; top: -7px;
  border-style: solid; border-width: 7px 0 7px 10px;
  border-color: transparent transparent transparent currentColor;
}
.horde-edge.incoming .horde-edge-glow,
.horde-edge.crate .horde-edge-glow {
  animation: horde-edge-pulse 1.2s ease-in-out infinite;
}
@keyframes horde-edge-pulse {
  0%, 100% { opacity: 0.55; } 50% { opacity: 1; }
}
`;

interface MarkerEl {
  root: HTMLDivElement;
  glow: HTMLDivElement;
  arrow: HTMLDivElement;
  badge: HTMLDivElement;
  label: HTMLSpanElement;
  marker: EdgeMarker;
}

/**
 * zfront: glows at the screen edge pointing at what the player can't see -
 * zombies, the announced wave's landings and supply crates. Clicking one
 * pans the camera there. Shown in horde games only; placed every animation
 * frame so it follows the camera smoothly.
 */
export class HordeEdgeIndicators implements Controller {
  private container: HTMLDivElement | null = null;
  private els = new Map<string, MarkerEl>();
  private frame: HordeFrame | null = null;
  private clusters: Float32Array = new Float32Array(0);
  private incoming: Float32Array = new Float32Array(0);
  private crates: CrateTarget[] = [];
  private raf = 0;
  private hud: ScreenRect[] = [];
  private hudMeasuredAt = -Infinity;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  init() {
    if (!this.game.config().gameConfig().horde) return;
    const container = document.createElement("div");
    container.dataset.hordeEdge = "";
    container.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;z-index:899;pointer-events:none;overflow:visible;";
    const style = document.createElement("style");
    style.textContent = STYLE;
    container.appendChild(style);
    document.body.appendChild(container);
    this.container = container;
    const loop = () => {
      this.place();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  tick() {
    if (this.container === null) return;
    const frame = this.game.hordeStatus();
    if (frame === this.frame) return;
    this.frame = frame;
    if (frame === null || frame.outcome === "lost") {
      this.clusters = new Float32Array(0);
      this.incoming = new Float32Array(0);
      this.crates = [];
      return;
    }
    this.clusters = hordeClusters(frame);
    this.incoming = incomingTargets(frame);
    this.crates = crateTargets(frame, this.game.width());
  }

  /** Stops the animation loop and removes the markers. */
  destroy() {
    cancelAnimationFrame(this.raf);
    this.container?.remove();
    this.container = null;
    this.els.clear();
  }

  private place() {
    const container = this.container;
    if (container === null) return;
    if (!container.isConnected) {
      this.destroy();
      return;
    }
    const th = this.transformHandler;
    const rect = th.boundingRect();
    const origin = th.worldToCanvasCoordinates(new Cell(0, 0));
    container.style.left = `${rect.left}px`;
    container.style.top = `${rect.top}px`;
    const now = performance.now();
    if (now - this.hudMeasuredAt >= HUD_MEASURE_MS) {
      this.hudMeasuredAt = now;
      this.hud = measureHud(rect);
    }
    const markers = edgeMarkers(
      this.clusters,
      this.incoming,
      this.crates,
      {
        scale: th.scale,
        originX: origin.x,
        originY: origin.y,
        width: rect.width,
        height: rect.height,
      },
      INSETS,
      this.hud,
    );
    const seen = new Set<string>();
    for (const m of markers) {
      const id = `${m.kind}:${m.key}`;
      seen.add(id);
      let el = this.els.get(id);
      if (el === undefined) {
        el = this.create(m);
        this.els.set(id, el);
        container.appendChild(el.root);
      }
      el.marker = m;
      this.update(el, m);
    }
    for (const [id, el] of this.els) {
      if (seen.has(id)) continue;
      el.root.remove();
      this.els.delete(id);
    }
  }

  private create(m: EdgeMarker): MarkerEl {
    const root = document.createElement("div");
    root.className = `horde-edge ${m.kind}`;
    root.dataset.hordeEdgeKind = m.kind;
    const rgb = COLORS[m.kind];
    root.style.color = `rgb(${rgb})`;
    const glow = document.createElement("div");
    glow.className = "horde-edge-glow";
    glow.style.background = `radial-gradient(circle, rgba(${rgb}, 0.9) 0%, rgba(${rgb}, 0.45) 35%, rgba(${rgb}, 0) 70%)`;
    const arrow = document.createElement("div");
    arrow.className = "horde-edge-arrow";
    const badge = document.createElement("div");
    badge.className = "horde-edge-badge";
    badge.setAttribute("role", "button");
    const label = document.createElement("span");
    badge.appendChild(label);
    root.append(glow, arrow, badge);
    const el: MarkerEl = { root, glow, arrow, badge, label, marker: m };
    badge.addEventListener("pointerdown", (e) => e.stopPropagation());
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      this.eventBus.emit(
        new GoToPositionEvent(el.marker.tileX, el.marker.tileY),
      );
    });
    return el;
  }

  private update(el: MarkerEl, m: EdgeMarker) {
    el.root.style.transform = `translate(${m.x}px, ${m.y}px)`;
    const near = Math.max(0, 1 - m.distance / FAR_TILES);
    const size = Math.round(
      (m.kind === "horde" ? 100 + 160 * m.strength : 130) *
        (0.75 + 0.25 * near),
    );
    el.glow.style.width = `${size}px`;
    el.glow.style.height = `${size}px`;
    if (m.kind === "horde") {
      el.glow.style.opacity = (m.strength * (0.7 + 0.3 * near)).toFixed(3);
    }
    el.arrow.style.transform = `rotate(${m.angle}rad)`;
    const amount = renderNumber(Math.round(m.amount));
    let label: string;
    let title: string;
    switch (m.kind) {
      case "horde":
        label = amount;
        title = translateText("horde_edge.horde", { count: amount });
        break;
      case "incoming":
        label = "!";
        title = translateText("horde_edge.incoming");
        break;
      case "crate":
        label = `+${amount}`;
        title = translateText("horde_edge.crate", { gold: amount });
        break;
    }
    if (el.label.textContent !== label) el.label.textContent = label;
    if (el.badge.title !== title) {
      el.badge.title = title;
      el.badge.setAttribute("aria-label", title);
    }
  }
}

/** The visible HUD panels, relative to the map canvas's rect. */
function measureHud(canvas: DOMRect): ScreenRect[] {
  const out: ScreenRect[] = [];
  for (const sel of HUD_SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({
        left: r.left - canvas.left,
        top: r.top - canvas.top,
        right: r.right - canvas.left,
        bottom: r.bottom - canvas.top,
      });
    }
  }
  return out;
}
