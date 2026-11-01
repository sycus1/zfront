import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";

/** amber-500: the map tint, never a UI colour. */
const AMBER = "#f2a93b";

/**
 * Night Shift's map tint, baked into a canvas the size of the image: the
 * image multiplied with amber, then black at `shade`, keeping its
 * transparency. Done once per image rather than with a CSS blend, which on a
 * big screen needs an offscreen surface past many GPUs' texture limit.
 */
export function nightShiftImage(
  image: HTMLImageElement,
  shade: number,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = image.naturalWidth;
  out.height = image.naturalHeight;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = AMBER;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
  ctx.fillRect(0, 0, out.width, out.height);
  // Multiply paints the transparent pixels too: cut back to the image.
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(image, 0, 0);
  return out;
}

/**
 * The ground behind a menu page (MapBackdrop): the selected map, tinted and
 * shaded, covering the viewport behind the page, with scanlines over it.
 * Changing `src` swaps the map.
 */
@customElement("zf-map-backdrop")
export class MapBackdrop extends LitElement {
  @property({ type: String }) src = "";
  @property({ type: Number }) shade = 0.72;

  private loaded = "";

  createRenderRoot() {
    return this;
  }

  protected updated(changed: PropertyValues) {
    if (!changed.has("src") && !changed.has("shade")) return;
    const key = `${this.src}|${this.shade}`;
    if (!this.src || key === this.loaded) return;
    this.loaded = key;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      // A later src may have replaced this one while it loaded.
      if (this.loaded !== key) return;
      const tinted = nightShiftImage(image, this.shade);
      tinted.className = "zf-backdrop-map";
      this.querySelector(".zf-backdrop-map")?.replaceWith(tinted);
    };
    image.src = this.src;
  }

  render() {
    return html`<canvas class="zf-backdrop-map" width="1" height="1"></canvas>
      <div class="zf-backdrop-scan"></div>`;
  }
}
