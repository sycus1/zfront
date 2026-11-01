import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { nightShiftImage } from "./MapBackdrop";

/**
 * The main menu's backdrop, "B2 Live Feed" in the zfront Main Menu canvas:
 * the Bath map and the game's building sprites, tinted amber and pushed into
 * shadow, with red zombies walking in from the west, south and river and
 * turrets firing at them. The map and sprites are tinted amber and shaded once,
 * into offscreen canvases; every frame then draws them, and the zombies,
 * tracers and flashes in their true colours on top, onto one canvas the size
 * of the viewport. The footage pans slowly and stops under
 * prefers-reduced-motion.
 *
 * Everything is on that one canvas on purpose. The box the footage is framed
 * in is far bigger than the screen (4,500px square on a 3440px ultrawide);
 * as DOM layers under a CSS blend mode it needed an offscreen surface that
 * size, which is past many GPUs' 4096px texture limit, and those browsers
 * dropped the map and showed flat amber. The canvas is capped below that.
 *
 * Positions are percentages of a square "box" laid over the viewport, as on
 * the canvas boards; desktop and phone frame the box differently and send the
 * horde along different paths so it stays on screen.
 */

/** Below this width the phone board's framing and paths apply. */
const PHONE_MAX_WIDTH = 640;

const PAN_SECONDS = 40;
const PAN_SCALE = 0.06;
const PAN_X = -0.01;
const PAN_Y = -0.008;

/** Amber multiply, then black at this opacity: the Night Shift study. */
const SHADE = 0.62;
const SPRITE_SIZE = 0.034;
const SPRITE_SHADOW = "rgba(0, 0, 0, 0.35)";

/** Largest canvas side: under the 4096px texture limit of many GPUs. */
export const MAX_CANVAS_SIDE = 4096;

const ZOMBIE_SIZE = 0.0042;
const KILL_SIZE = 0.007;
const ZOMBIE_EDGE = "rgba(60, 6, 4, 0.55)";
const KILL_RGB: Rgb = [0x59, 0x10, 0x09]; // kill-900

const TRACER_SECONDS = 0.55;
const TRACER_LENGTH = 0.07;
const TRACER_CORE = "#fff2b3"; // tracer-100
const TRACER_GLOW = "rgba(255, 217, 115, 0.9)";
const FLASH_SIZE = 0.007;
const FLASH_CORE = "#fff6d5";
const FLASH_GLOW = "rgba(255, 166, 64, 0.85)"; // flash-400

/** The framing of the box: which point of it sits at the viewport centre. */
interface Frame {
  anchorX: number;
  anchorY: number;
}
const DESKTOP_FRAME: Frame = { anchorX: 0.58, anchorY: 0.55 };
const PHONE_FRAME: Frame = { anchorX: 0.58, anchorY: 0.68 };

type Rgb = [number, number, number];

interface Zombie {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rgb: Rgb;
  duration: number;
  offset: number;
}

interface Turret {
  x: number;
  y: number;
  angle: number;
  offset: number;
}

interface Sprite {
  file: string;
  x: number;
  y: number;
  /** Width as a percentage of the box; sprites are square. */
  width?: number;
}

const BUILDINGS: Sprite[] = [
  { file: "hq", x: 57.7, y: 65.6, width: 4.4 },
  { file: "houses", x: 62, y: 63 },
  { file: "depot", x: 60.5, y: 68.6 },
  { file: "watchtower", x: 57, y: 60.4 },
  { file: "mortar", x: 53.6, y: 59.2 },
];

const TURRETS: Turret[] = [
  { x: 50.8, y: 61.6, angle: 182, offset: 0.05 },
  { x: 51.4, y: 69.4, angle: 168, offset: 0.3 },
  { x: 56.4, y: 73.2, angle: 118, offset: 0.18 },
  { x: 62.6, y: 73.4, angle: 96, offset: 0.42 },
];

type Range = [number, number];
interface Route {
  x0: Range;
  y0: Range;
  x1: Range;
  y1: Range;
}
interface Horde {
  count: number;
  duration: Range;
  west: Route;
  south: Route;
  river: Route;
}

const DESKTOP_HORDE: Horde = {
  count: 160,
  duration: [16, 30],
  west: { x0: [14, 18], y0: [50, 82], x1: [49.5, 51.5], y1: [58, 72] },
  south: { x0: [36, 66], y0: [81, 84], x1: [52, 64], y1: [73.5, 76] },
  river: { x0: [18, 30], y0: [74, 82], x1: [50, 53], y1: [68, 73] },
};

const PHONE_HORDE: Horde = {
  count: 110,
  duration: [10, 18],
  west: { x0: [40, 44], y0: [50, 82], x1: [49.5, 51.5], y1: [58, 72] },
  south: { x0: [46, 66], y0: [81, 84], x1: [52, 64], y1: [73.5, 76] },
  river: { x0: [40, 46], y0: [74, 82], x1: [50, 53], y1: [68, 73] },
};

/**
 * The horde, from a fixed seed so the footage is the same on every visit.
 * Exported for tests.
 */
export function buildHorde(horde: Horde): Zombie[] {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const r = ([a, b]: Range) => a + (b - a) * rnd();
  const zombies: Zombie[] = [];
  for (let i = 0; i < horde.count; i++) {
    const v = rnd();
    const route = v < 0.5 ? horde.west : v < 0.8 ? horde.south : horde.river;
    const x0 = r(route.x0);
    const y0 = r(route.y0);
    const x1 = r(route.x1);
    const y1 = r(route.y1);
    const k = rnd();
    const rgb: Rgb = [
      Math.round(199 + 56 * k),
      Math.round(26 + 66 * k),
      Math.round(18 + 33 * k),
    ];
    const duration = r(horde.duration);
    zombies.push({ x0, y0, x1, y1, rgb, duration, offset: r([0, duration]) });
  }
  return zombies;
}

export const LIVE_FEED_HORDES = { desktop: DESKTOP_HORDE, phone: PHONE_HORDE };

/**
 * The canvas's device-pixel ratio: the screen's, capped at 1.5 (the footage
 * is soft and shaded anyway) and so neither side passes MAX_CANVAS_SIDE.
 */
export function canvasScale(
  width: number,
  height: number,
  devicePixelRatio: number,
): number {
  return Math.min(
    devicePixelRatio || 1,
    1.5,
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
  );
}

/** CSS ease-in-out, close enough for a 40s pan. */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * One zombie's walk at `u` (0..1) through its cycle: in from the edge, a
 * straight walk to its kill point, then it dies there and fades.
 */
export function zombieAt(
  z: Zombie,
  u: number,
): { x: number; y: number; size: number; rgb: Rgb; alpha: number } {
  const walk = Math.min(u / 0.92, 1);
  const x = lerp(z.x0, z.x1, walk);
  const y = lerp(z.y0, z.y1, walk);
  let alpha = 1;
  if (u < 0.05) alpha = u / 0.05;
  else if (u > 0.92) alpha = lerp(0.85, 0, (u - 0.92) / 0.08);
  else if (u > 0.86) alpha = lerp(1, 0.85, (u - 0.86) / 0.06);
  const dying = u <= 0.86 ? 0 : Math.min((u - 0.86) / 0.06, 1);
  const rgb: Rgb = [
    Math.round(lerp(z.rgb[0], KILL_RGB[0], dying)),
    Math.round(lerp(z.rgb[1], KILL_RGB[1], dying)),
    Math.round(lerp(z.rgb[2], KILL_RGB[2], dying)),
  ];
  return { x, y, size: lerp(ZOMBIE_SIZE, KILL_SIZE, dying), rgb, alpha };
}

@customElement("zf-live-feed")
export class LiveFeedBackdrop extends LitElement {
  private zombies: Zombie[] = [];
  private frame: Frame = DESKTOP_FRAME;
  private phone: boolean | null = null;
  private reducedMotion = false;

  /** The box in host pixels: its size and top-left corner. */
  private boxSize = 0;
  private boxLeft = 0;
  private boxTop = 0;
  private dpr = 1;

  /** The map and sprites, tinted and shaded, once they have loaded. */
  private map: HTMLCanvasElement | null = null;
  private sprites = new Map<string, HTMLCanvasElement>();

  private raf = 0;
  private visible = false;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private motionQuery: MediaQueryList | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("aria-hidden", "true");
    this.motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.motionQuery?.matches ?? false;
    this.motionQuery?.addEventListener("change", this.onMotionChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stop();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  firstUpdated() {
    this.loadImages();
    this.layout();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.layout();
        this.draw(performance.now() / 1000);
      });
      this.resizeObserver.observe(this);
    }
    // Hidden during a match (display: none), so the loop stops with it.
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        this.syncLoop();
      });
      this.intersectionObserver.observe(this);
    } else {
      this.visible = true;
      this.syncLoop();
    }
  }

  private onMotionChange = (e: MediaQueryListEvent) => {
    this.reducedMotion = e.matches;
    this.syncLoop();
    this.draw(performance.now() / 1000);
  };

  private onVisibilityChange = () => this.syncLoop();

  private syncLoop() {
    const run = this.visible && !document.hidden && !this.reducedMotion;
    if (run && this.raf === 0) {
      this.raf = requestAnimationFrame(this.tick);
    } else if (!run) {
      this.stop();
      if (this.visible) this.draw(0);
    }
  }

  private stop() {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    this.draw(now / 1000);
    this.raf = requestAnimationFrame(this.tick);
  };

  private loadImages() {
    const load = (path: string, done: (c: HTMLCanvasElement) => void) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        done(nightShiftImage(image, SHADE));
        // A still frame (reduced motion, or a hidden tab) needs a redraw.
        this.draw(performance.now() / 1000);
      };
      image.src = assetUrl(path);
    };
    load("images/menu/bath-feed.png", (c) => (this.map = c));
    const files = new Set([...BUILDINGS.map((b) => b.file), "turret"]);
    for (const file of files) {
      load(`images/menu/${file}.png`, (c) => this.sprites.set(file, c));
    }
  }

  private get canvas(): HTMLCanvasElement | null {
    return this.querySelector("canvas");
  }

  /** Sizes the box and the canvas to the host, and picks the board. */
  private layout() {
    const width = this.clientWidth;
    const height = this.clientHeight;
    if (width === 0 || height === 0) return;

    const phone = width < PHONE_MAX_WIDTH;
    if (phone !== this.phone) {
      this.phone = phone;
      this.frame = phone ? PHONE_FRAME : DESKTOP_FRAME;
      this.zombies = buildHorde(phone ? PHONE_HORDE : DESKTOP_HORDE);
    }

    this.boxSize = Math.max(1.3 * width, 1.6 * height);
    this.boxLeft = width / 2 - this.frame.anchorX * this.boxSize;
    this.boxTop = height / 2 - this.frame.anchorY * this.boxSize;

    const canvas = this.canvas;
    if (canvas) {
      this.dpr = canvasScale(width, height, window.devicePixelRatio);
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);
    }
  }

  /** The pan at time `t`: 40s each way, eased, as the board's CSS. */
  private panAt(t: number): { scale: number; tx: number; ty: number } {
    if (this.reducedMotion) return { scale: 1, tx: 0, ty: 0 };
    const phase = (t % (2 * PAN_SECONDS)) / PAN_SECONDS;
    const e = easeInOut(phase <= 1 ? phase : 2 - phase);
    return {
      scale: 1 + PAN_SCALE * e,
      tx: PAN_X * e * this.boxSize,
      ty: PAN_Y * e * this.boxSize,
    };
  }

  private draw(t: number) {
    const canvas = this.canvas;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || this.boxSize === 0) return;

    const { scale, tx, ty } = this.panAt(t);

    // Box percentages to canvas pixels, through the pan (scale about the
    // box centre, after the translate, as CSS composes it).
    const half = this.boxSize / 2;
    const px = (x: number) =>
      (this.boxLeft + half + scale * ((x / 100) * this.boxSize - half + tx)) *
      this.dpr;
    const py = (y: number) =>
      (this.boxTop + half + scale * ((y / 100) * this.boxSize - half + ty)) *
      this.dpr;
    const unit = this.boxSize * scale * this.dpr;

    // The ground: ink until the map arrives, then the tinted map and the
    // buildings, pixelated as the game draws them.
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    if (this.map) ctx.drawImage(this.map, px(0), py(0), unit, unit);
    ctx.shadowColor = SPRITE_SHADOW;
    ctx.shadowOffsetY = 2 * this.dpr;
    const sprites: Sprite[] = [
      ...BUILDINGS,
      ...TURRETS.map((tt) => ({ file: "turret", x: tt.x, y: tt.y })),
    ];
    for (const s of sprites) {
      const image = this.sprites.get(s.file);
      if (!image) continue;
      const size = ((s.width ?? SPRITE_SIZE * 100) / 100) * unit;
      ctx.drawImage(image, px(s.x) - size / 2, py(s.y) - size / 2, size, size);
    }
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetY = 0;

    for (const z of this.zombies) {
      // Reduced motion: the horde stands at its kill points, alive.
      const s = this.reducedMotion
        ? { x: z.x1, y: z.y1, size: ZOMBIE_SIZE, rgb: z.rgb, alpha: 1 }
        : zombieAt(
            z,
            ((((t + z.offset) % z.duration) + z.duration) % z.duration) /
              z.duration,
          );
      if (s.alpha <= 0) continue;
      const size = s.size * unit;
      const x = px(s.x) - size / 2;
      const y = py(s.y) - size / 2;
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`;
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = ZOMBIE_EDGE;
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    }

    for (const turret of TURRETS) {
      const cycle = this.reducedMotion
        ? 0
        : (((t + turret.offset) % TRACER_SECONDS) + TRACER_SECONDS) %
          TRACER_SECONDS;
      const u = cycle / TRACER_SECONDS;
      const angle = (turret.angle * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // The tracer burns from the muzzle outwards: its tail is clipped away.
      const alpha =
        u < 0.6 ? lerp(1, 0.7, u / 0.6) : lerp(0.7, 0, (u - 0.6) / 0.4);
      const length = TRACER_LENGTH * 100;
      const from = 0.75 * u * length;
      const x0 = px(turret.x + cos * from);
      const y0 = py(turret.y + sin * from);
      const x1 = px(turret.x + cos * length);
      const y1 = py(turret.y + sin * length);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = TRACER_CORE;
      ctx.lineWidth = 3 * this.dpr;
      ctx.lineCap = "butt";
      ctx.shadowColor = TRACER_GLOW;
      ctx.shadowBlur = 6 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      // The muzzle flash blinks on for the first half of each shot.
      if (u < 0.5) {
        const fx = px(turret.x + 1.4 * cos);
        const fy = py(turret.y + 1.4 * sin);
        ctx.globalAlpha = 1;
        ctx.fillStyle = FLASH_CORE;
        ctx.shadowColor = FLASH_GLOW;
        ctx.shadowBlur = 14 * this.dpr;
        ctx.beginPath();
        ctx.arc(fx, fy, (FLASH_SIZE * unit) / 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  render() {
    return html`
      <canvas class="zf-feed-canvas"></canvas>
      <div class="zf-feed-scan"></div>
    `;
  }
}
