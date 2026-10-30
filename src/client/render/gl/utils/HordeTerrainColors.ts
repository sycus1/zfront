/**
 * zfront's terrain colours: the map drawn as the horde sees it.
 *
 * Every tile takes its meaning from its coarse (2x2-tile) cell, the grid the
 * horde moves on and wall posts snap to, so what looks blocked is blocked:
 *
 * - open ground the horde walks on, light, darker the slower it is;
 * - solid ground (cliffs, mountains, buildings) that blocks the horde and
 *   holds walls, dark, with a darker rim on the faces that touch open
 *   ground and a shadow on the open ground below and right of it;
 * - water, which blocks the horde but holds no wall, blue with no rim.
 *
 * Rim tiles carry SNAP_FACE_ALPHA in the alpha channel so the terrain shader
 * can light up the ones a wall post being placed could snap to.
 */

import {
  HORDE_BLOCKED_MAGNITUDE,
  hordeMoveCost,
} from "@openfront/engine-lib/game/HordeTerrain";
import renderDefaults from "../render-settings.json";
import { hexToRgb, TerrainColorOverrides } from "./ColorUtils";

/** The horde's coarse grid: the mini map's terrain bytes. */
export interface HordeTerrainGrid {
  cellBytes: Uint8Array;
  cellWidth: number;
  cellHeight: number;
  blockedMagnitude?: number;
}

/** Alpha of solid tiles that face open ground (wall snap faces). */
export const SNAP_FACE_ALPHA = 128;

/** Cell magnitude from which solid ground is drawn as a building or peak. */
export const BUILDING_MAGNITUDE = 28;

/** Darkening per step of horde movement cost on open ground. */
const COST_SHADE = 12;
/** Brightness of open ground in the shadow of solid ground. */
const SHADOW = 0.82;
/** Brightness of a solid tile's rim. */
const RIM = 0.6;

const OPEN = 0;
const SOLID = 1;
const WATER = 2;

type Rgb = readonly [number, number, number];

function color(override: Rgb | undefined, fallback: string): Rgb {
  return override ?? hexToRgb(fallback)!;
}

/** Bake the terrain texture (RGBA per tile) from the horde's grid. */
export function buildHordeTerrainRGBA(
  terrainBytes: Uint8Array,
  w: number,
  h: number,
  grid: HordeTerrainGrid,
  colors?: TerrainColorOverrides,
): Uint8Array {
  const t = renderDefaults.terrain;
  const background = color(colors?.backgroundColor, t.backgroundColor);
  const ocean = color(colors?.oceanColor, t.oceanColor);
  const shore = color(colors?.sandColor, t.sandColor);
  const ground = color(colors?.plainsColor, t.plainsColor);
  const rock = color(colors?.highlandColor, t.highlandColor);
  const building = color(colors?.mountainColor, t.mountainColor);

  const { cellBytes, cellWidth: cw, cellHeight: ch } = grid;
  const blocked = grid.blockedMagnitude ?? HORDE_BLOCKED_MAGNITUDE;
  const cellAt = (x: number, y: number) =>
    Math.min(y >> 1, ch - 1) * cw + Math.min(x >> 1, cw - 1);

  // Each tile's meaning, from its cell.
  const kind = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = cellBytes[cellAt(x, y)];
      kind[y * w + x] =
        hordeMoveCost(b, blocked) > 0 ? OPEN : b & 0x80 ? SOLID : WATER;
    }
  }
  const kindAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? -1 : kind[y * w + x];

  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const tb = terrainBytes[i];
      const isLand = (tb & 0x80) !== 0;
      const isShore = (tb & 0x40) !== 0;
      const mag = tb & 0x1f;
      const cell = cellBytes[cellAt(x, y)];
      let rgb: Rgb;
      let shade = 1;
      let alpha = 255;
      if (isLand && mag === 31) {
        // Impassable: the map background, so the map keeps its outline.
        rgb = background;
      } else if (kind[i] === WATER) {
        if (isLand || isShore) {
          // Shallows: 70% water, 30% white, as before.
          rgb = [
            0.7 * ocean[0] + 76.5,
            0.7 * ocean[1] + 76.5,
            0.7 * ocean[2] + 76.5,
          ];
        } else {
          const d = Math.min(mag, 10);
          rgb = [ocean[0] - d, ocean[1] - d, ocean[2] - d];
        }
      } else if (kind[i] === SOLID) {
        rgb = (cell & 0x1f) >= BUILDING_MAGNITUDE ? building : rock;
        const face =
          kindAt(x - 1, y) === OPEN ||
          kindAt(x + 1, y) === OPEN ||
          kindAt(x, y - 1) === OPEN ||
          kindAt(x, y + 1) === OPEN;
        if (face) {
          shade = RIM;
          alpha = SNAP_FACE_ALPHA;
        }
      } else {
        const base = isLand && isShore ? shore : ground;
        const d = COST_SHADE * (hordeMoveCost(cell, blocked) - 1);
        rgb = [base[0] - d, base[1] - d, base[2] - d];
        if (kindAt(x, y - 1) === SOLID || kindAt(x - 1, y) === SOLID) {
          shade = SHADOW;
        }
      }
      const o = i * 4;
      out[o] = Math.max(0, Math.min(255, Math.round(rgb[0] * shade)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] * shade)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] * shade)));
      out[o + 3] = alpha;
    }
  }
  return out;
}
