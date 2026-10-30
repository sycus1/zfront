import { describe, expect, it } from "vitest";
import { hexToRgb } from "../../src/client/render/gl/utils/ColorUtils";
import {
  buildHordeTerrainRGBA,
  SNAP_FACE_ALPHA,
} from "../../src/client/render/gl/utils/HordeTerrainColors";

const land = (mag: number) => 0x80 | mag;
const WATER = 0x20;

const colors = {
  backgroundColor: hexToRgb("#3c3c3c")!,
  oceanColor: hexToRgb("#3b7fc4")!,
  sandColor: hexToRgb("#e3dfd4")!,
  plainsColor: hexToRgb("#e2e6c4")!,
  highlandColor: hexToRgb("#6b5f54")!,
  mountainColor: hexToRgb("#4d4845")!,
};

// A 4x2-cell map (8x4 tiles): cells are open (mag 0), open (mag 8, cost 3),
// building (mag 30) and water on the top row, open below.
function bake(fine?: (x: number, y: number) => number) {
  const cw = 4;
  const ch = 2;
  const cellBytes = new Uint8Array([
    land(0),
    land(8),
    land(30),
    WATER,
    land(0),
    land(0),
    land(0),
    land(0),
  ]);
  const w = cw * 2;
  const h = ch * 2;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      tiles[y * w + x] = fine
        ? fine(x, y)
        : cellBytes[(y >> 1) * cw + (x >> 1)];
    }
  }
  const rgba = buildHordeTerrainRGBA(
    tiles,
    w,
    h,
    { cellBytes, cellWidth: cw, cellHeight: ch },
    colors,
  );
  return (x: number, y: number) =>
    Array.from(rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
}

describe("buildHordeTerrainRGBA", () => {
  it("draws open ground lighter the faster the horde crosses it", () => {
    const px = bake();
    expect(px(0, 0)).toEqual([226, 230, 196, 255]);
    // Cost 3: two shades darker.
    expect(px(2, 0)).toEqual([226 - 24, 230 - 24, 196 - 24, 255]);
  });

  it("draws solid ground with a snap-face rim and a shadow below it", () => {
    const px = bake();
    // The building's tiles all touch open ground, so all are rim tiles.
    const rim = px(4, 0);
    expect(rim[3]).toBe(SNAP_FACE_ALPHA);
    expect(rim.slice(0, 3)).toEqual([46, 43, 41]);
    // The open tile below the building is in its shadow.
    expect(px(4, 2)).toEqual([185, 189, 161, 255]);
  });

  it("draws water as water, with no snap faces", () => {
    const px = bake();
    expect(px(7, 1)[3]).toBe(255);
    expect(px(7, 1).slice(0, 3)).toEqual([59, 127, 196]);
  });

  it("takes each tile's meaning from its cell, not the tile", () => {
    // A building tile in an open cell is open; a road tile in the
    // building's cell is solid.
    const px = bake((x, y) =>
      x === 0 && y === 0 ? land(30) : x === 5 && y === 1 ? land(0) : land(0),
    );
    expect(px(0, 0)).toEqual([226, 230, 196, 255]);
    expect(px(5, 1)[3]).toBe(SNAP_FACE_ALPHA);
  });

  it("keeps impassable tiles the background colour", () => {
    const px = bake((x, y) => (x === 0 && y === 0 ? land(31) : land(0)));
    expect(px(0, 0)).toEqual([60, 60, 60, 255]);
  });
});
