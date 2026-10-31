import { UnitType } from "@openfront/engine-api/game/GameTypes";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { decodePng } from "../scripts/realmap/png";
import {
  BUILDING_ORDER,
  buildAtlases,
  CELL,
  CELL_ORDER,
  FRAME,
} from "../scripts/sprites/buildingSprites";

const atlasDir = path.join(__dirname, "../resources/atlases");

function committed(name: string) {
  return decodePng(fs.readFileSync(path.join(atlasDir, name)));
}

describe("building sprites", () => {
  const { buildings, cells } = buildAtlases();

  it("committed atlases match the generator", () => {
    // Re-run `npx tsx scripts/sprites/buildingSprites.ts` after editing it.
    const b = committed("building-sprites.png");
    expect([b.width, b.height]).toEqual([buildings.w, buildings.h]);
    expect(Buffer.from(b.pixels).equals(Buffer.from(buildings.rgba))).toBe(
      true,
    );
    const c = committed("cell-sprites.png");
    expect([c.width, c.height]).toEqual([cells.w, cells.h]);
    expect(Buffer.from(c.pixels).equals(Buffer.from(cells.rgba))).toBe(true);
  });

  it("frames follow StructurePass's column order, then the HQ", () => {
    expect(BUILDING_ORDER).toEqual([
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.Outpost,
      "HQ",
    ]);
    expect(buildings.w).toBe(FRAME * BUILDING_ORDER.length);
    expect(buildings.h).toBe(FRAME * 2);
  });

  it("every building but the SAM launcher has art, and its mask sits on it", () => {
    const w = buildings.w;
    BUILDING_ORDER.forEach((name, col) => {
      let opaque = 0;
      let masked = 0;
      for (let y = 0; y < FRAME; y++)
        for (let x = col * FRAME; x < (col + 1) * FRAME; x++) {
          const a = buildings.rgba[(y * w + x) * 4 + 3];
          const m = buildings.rgba[((y + FRAME) * w + x) * 4 + 3];
          if (a === 255) opaque++;
          if (m > 0) {
            masked++;
            expect(a, `${name} mask at ${x},${y}`).toBe(255);
          }
        }
      if (name === UnitType.SAMLauncher) {
        expect(opaque).toBe(0);
      } else {
        expect(opaque, name).toBeGreaterThan(150);
        // The owner's colour shows on every building.
        expect(masked, name).toBeGreaterThan(0);
      }
    });
  });

  it("walls fill their whole cell; the others leave the ground showing", () => {
    CELL_ORDER.forEach((name, col) => {
      let opaque = 0;
      for (let y = 0; y < CELL; y++)
        for (let x = 0; x < CELL; x++)
          if (cells.rgba[(y * cells.w + col * CELL + x) * 4 + 3] === 255)
            opaque++;
      if (name.startsWith("wall")) expect(opaque, name).toBe(CELL * CELL);
      else {
        expect(opaque, name).toBeGreaterThan(8);
        expect(opaque, name).toBeLessThan(CELL * CELL);
      }
    });
  });
});
