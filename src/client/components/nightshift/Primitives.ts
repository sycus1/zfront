import { html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { type IconName, zfIcon } from "./Icon";
import "./MapBackdrop";

/**
 * Night Shift building blocks for the menu pages, as Lit templates. Ported
 * from the zfront Night Shift design system's components (Button,
 * BackButton, Steps, Tile, OptionGroup, SwitchChip, ToggleChip, TextField,
 * MapCard, TerrainBars, ActionStrip, MapBackdrop); their look is in
 * styles/nightshift.css. They hold no state: the page owns it and passes a
 * callback.
 *
 * Every interactive control sits in a .zf-ring, which draws the focus
 * outline outside the clipped corner.
 */

export interface Choice<T> {
  value: T;
  label: string;
}

/** The page's one primary action, ink on yellow (inside an ActionStrip). */
export function zfPrimaryButton(opts: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}): TemplateResult {
  return html`<div class="zf-ring">
    <button
      type="button"
      class="zf-btn zf-btn-ink zf-btn-lg zf-frame zf-sweep"
      ?disabled=${opts.disabled}
      aria-busy=${opts.busy ? "true" : "false"}
      @click=${opts.onClick}
    >
      <span>${opts.label}</span>
      ${zfIcon("arrow-right", 36, 3)}
    </button>
  </div>`;
}

/**
 * Leaves the page: an outline arrow and the destination in capitals. On
 * phone it is the arrow alone, named by `label` for screen readers.
 */
export function zfBackButton(opts: {
  label: string;
  onClick: () => void;
}): TemplateResult {
  return html`<div class="zf-ring">
    <button
      type="button"
      class="zf-back zf-frame zf-sweep"
      aria-label=${opts.label}
      @click=${opts.onClick}
    >
      ${zfIcon("arrow-left")}
      <span class="zf-back-label" aria-hidden="true">${opts.label}</span>
    </button>
  </div>`;
}

export type StepState = "done" | "current" | "upcoming";

/** Where the player is in a multi-step flow: 01 MAP, 02 SETUP. */
export function zfSteps(
  label: string,
  steps: { label: string; state: StepState }[],
): TemplateResult {
  return html`<ol class="zf-steps" aria-label=${label}>
    ${steps.map(
      (s) =>
        html`<li
          class="zf-step zf-step-${s.state} zf-frame"
          aria-current=${ifDefined(s.state === "current" ? "step" : undefined)}
        >
          ${s.state === "done" ? zfIcon("check", 14, 3.5) : nothing}${s.label}
        </li>`,
    )}
  </ol>`;
}

/** The header row of a menu page: BackButton left, Steps right. */
export function zfPageHeader(
  back: TemplateResult,
  steps?: TemplateResult,
): TemplateResult {
  return html`<header class="zf-page-header">
    ${back}${steps ?? nothing}
  </header>`;
}

/** The page title, one per page, in the stencil face. */
export function zfPageTitle(id: string, text: string): TemplateResult {
  return html`<h1 id=${id} class="zf-page-title" tabindex="-1">${text}</h1>`;
}

/**
 * A titled group of controls (a fieldset, so the title names them). A
 * disabled tile is dimmed and its controls can't be used.
 */
export function zfTile(opts: {
  title: string;
  body: TemplateResult;
  disabled?: boolean;
  /** Shown beside a disabled tile's title, e.g. "Coming Soon". */
  note?: string;
  className?: string;
}): TemplateResult {
  return html`<fieldset
    class="zf-tile zf-frame zf-frame-lg ${opts.className ?? ""}"
    ?disabled=${opts.disabled}
  >
    <legend class="zf-tile-title">
      <span>${opts.title}</span>
      ${opts.note ? html`<span class="zf-tile-note">${opts.note}</span>` : nothing}
    </legend>
    <div class="zf-tile-body">${opts.body}</div>
  </fieldset>`;
}

/** Pick exactly one: stencil buttons in an equal grid. */
export function zfOptionGroup<T>(opts: {
  label: string;
  options: Choice<T>[];
  value: T;
  onSelect: (value: T) => void;
  columns?: number;
  fontSize?: string;
  disabled?: boolean;
}): TemplateResult {
  const cols = opts.columns ?? opts.options.length;
  return html`<div
    role="radiogroup"
    aria-label=${opts.label}
    class="zf-options"
    style="--zf-cols: ${cols}"
  >
    ${opts.options.map((o) => {
      const on = o.value === opts.value;
      return html`<div class="zf-ring">
        <button
          type="button"
          role="radio"
          aria-checked=${on ? "true" : "false"}
          class="zf-option zf-frame zf-sweep"
          style=${ifDefined(opts.fontSize ? `font-size: ${opts.fontSize}` : undefined)}
          ?disabled=${opts.disabled}
          @click=${() => opts.onSelect(o.value)}
        >
          ${o.label}
        </button>
      </div>`;
    })}
  </div>`;
}

/** An on/off setting as a chip with a small square switch. */
export function zfSwitchChip(opts: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}): TemplateResult {
  return html`<div class="zf-ring">
    <button
      type="button"
      role="switch"
      aria-checked=${opts.checked ? "true" : "false"}
      class="zf-chip zf-frame zf-sweep"
      ?disabled=${opts.disabled}
      @click=${() => opts.onToggle(!opts.checked)}
    >
      ${opts.label}
      <span class="zf-switch" aria-hidden="true"><span></span></span>
    </button>
  </div>`;
}

/** Allow or exclude an item from a set; excluded items are struck through. */
export function zfToggleChip(opts: {
  label: string;
  icon?: IconName;
  pressed: boolean;
  onToggle: (pressed: boolean) => void;
}): TemplateResult {
  return html`<div class="zf-ring">
    <button
      type="button"
      aria-pressed=${opts.pressed ? "true" : "false"}
      class="zf-chip zf-chip-toggle zf-frame zf-sweep"
      @click=${() => opts.onToggle(!opts.pressed)}
    >
      ${opts.icon ? zfIcon(opts.icon, 16, 3) : nothing} ${opts.label}
    </button>
  </div>`;
}

/** A labelled text or number field: cream fill, ink text. */
export function zfTextField(opts: {
  id: string;
  label: string;
  value: string;
  onInput: (e: Event) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  type?: "text" | "number";
  inputmode?: "numeric" | "decimal";
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | "any";
}): TemplateResult {
  return html`<div class="zf-text-field">
    <label for=${opts.id} class="zf-text-field-label">${opts.label}</label>
    <div class="zf-ring">
      <input
        id=${opts.id}
        class="zf-frame zf-field zf-field-${opts.type ?? "text"}"
        type=${opts.type ?? "text"}
        inputmode=${ifDefined(opts.inputmode)}
        placeholder=${ifDefined(opts.placeholder)}
        min=${ifDefined(opts.min)}
        max=${ifDefined(opts.max)}
        step=${ifDefined(opts.step)}
        .value=${opts.value}
        @input=${opts.onInput}
        @keydown=${opts.onKeyDown}
      />
    </div>
  </div>`;
}

/**
 * A map to choose: preview, stencil name, short capital tag. On desktop a
 * card; under 640px a row with a small preview, so every map fits.
 */
export function zfMapCard(opts: {
  name: string;
  tag: string;
  image: string;
  imagePosition?: string;
  selected: boolean;
  onSelect: () => void;
}): TemplateResult {
  return html`<div class="zf-ring">
    <button
      type="button"
      role="radio"
      aria-checked=${opts.selected ? "true" : "false"}
      class="zf-map zf-frame zf-frame-lg zf-sweep"
      @click=${opts.onSelect}
    >
      <img
        src=${opts.image}
        alt=""
        draggable="false"
        style=${ifDefined(
          opts.imagePosition
            ? `object-position: ${opts.imagePosition}`
            : undefined,
        )}
      />
      <span class="zf-map-bar">
        <span class="zf-map-name">${opts.name}</span>
        <span class="zf-map-tag">${opts.tag}</span>
      </span>
    </button>
  </div>`;
}

/** How a map's ground splits, on yellow, percentages in the data face. */
export function zfTerrainBars(
  rows: { label: string; pct: number; kind: "open" | "solid" | "water" }[],
): TemplateResult {
  return html`<div class="zf-terrain">
    ${rows.map(
      (r) =>
        html`<div class="zf-terrain-row">
          <span>${r.label}</span>
          <span class="zf-terrain-pct">${r.pct}%</span>
          <div class="zf-terrain-track" role="presentation">
            <div
              class="zf-terrain-fill zf-terrain-${r.kind}"
              style="width: ${r.pct}%"
            ></div>
          </div>
        </div>`,
    )}
  </div>`;
}

/**
 * The yellow bar that ends a page: what was chosen, then the page's one
 * primary action. Sticky to the bottom on phone.
 */
export function zfActionStrip(opts: {
  label: string;
  items?: { label: string; value: string }[];
  content?: TemplateResult;
  action: TemplateResult;
  /** On phone, keep the summary and the action on one row. */
  compact?: boolean;
}): TemplateResult {
  return html`<div
    class="zf-strip zf-frame zf-frame-lg ${opts.compact ? "zf-strip-compact" : ""}"
  >
    ${
      opts.items
        ? html`<dl class="zf-strip-items" aria-label=${opts.label}>
            ${opts.items.map(
              (i) =>
                html`<div class="zf-strip-item">
                  <dt>${i.label}</dt>
                  <dd>${i.value}</dd>
                </div>`,
            )}
          </dl>`
        : html`<div class="zf-strip-items" aria-label=${opts.label}>
            ${opts.content}
          </div>`
    }
    <div class="zf-strip-action">${opts.action}</div>
  </div>`;
}

/**
 * The Night Shift ground behind a menu page: a map multiplied with amber,
 * darkened and scanned (<zf-map-backdrop>). Fixed to the viewport, behind
 * the page.
 */
export function zfMapBackdrop(image: string, shade = 0.72): TemplateResult {
  return html`<zf-map-backdrop
    aria-hidden="true"
    .src=${image}
    .shade=${shade}
  ></zf-map-backdrop>`;
}
