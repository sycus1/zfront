import { svg, type TemplateResult } from "lit";

/**
 * Night Shift icons: square-capped, mitred line icons on a 24px grid, in
 * currentColor. Ported from the zfront Night Shift design system's Icon.
 */
const PATHS = {
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  "arrow-left": "M19 12H5M11 6l-6 6 6 6",
  check: "M4 12l5 5L20 6",
  close: "M5 5l14 14M19 5L5 19",
  reset: "M4 4v6h6M4.6 10A8 8 0 1 1 6 17",
  book: "M3 5h7l2 2v13l-2-2H3zM21 5h-7l-2 2v13l2-2h7z",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5A2.5 2.5 0 1 1 13 11.8c-.6.3-1 .9-1 1.6V14M12 17v1",
  warning: "M12 3L2 21h20zM12 10v5M12 17.5v1",
  walls: "M3 5h18v6H3zM3 13h18v6H3zM9 5v6M15 13v6",
  turret: "M4 20h16M7 20l2-6h6l2 6M12 14V8l6-4",
  mine: "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 2v3M12 19v3M2 12h3M19 12h3",
  beacon: "M12 12v9M8 8a5 5 0 0 1 8 0M5 5a9 9 0 0 1 14 0",
  depot: "M3 10l9-6 9 6v10H3zM9 20v-6h6v6",
  mortar: "M5 20h14M8 20l4-9 4 9M12 11l5-7",
  silo: "M12 2l4 6v10H8V8zM8 18l-3 3M16 18l3 3",
  outpost: "M6 21V4M6 4h11l-3 4 3 4H6",
  pause: "M8 5v14M16 5v14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  copy: "M8 8h12v12H8zM4 16V4h12",
  play: "M7 4l13 8-13 8z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7v1",
  keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
  unlink: "M9 15l-2 2a3 3 0 0 1-4-4l3-3M15 9l2-2a3 3 0 0 1 4 4l-3 3M4 4l16 16",
  "chevron-down": "M6 9l6 6 6-6",
} as const;

export type IconName = keyof typeof PATHS;

/** A decorative icon (aria-hidden); label the control that holds it. */
export function zfIcon(
  name: IconName,
  size = 20,
  strokeWidth = 2.6,
  className = "",
): TemplateResult {
  return svg`<svg
    class="zf-icon ${className}"
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width=${strokeWidth}
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
  ><path d=${PATHS[name]}></path></svg>`;
}
