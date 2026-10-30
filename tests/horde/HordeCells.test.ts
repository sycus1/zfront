import {
  HORDE_DENSITY_MAX_BYTE,
  HORDE_EXACT_MAX,
  hordeDensityByte,
  hordeDensityCount,
} from "@openfront/engine-lib/game/HordeCells";
import { DEFAULT_CELL_CAP } from "@openfront/engine/horde/HordeField";
import { describe, expect, test } from "vitest";

describe("horde density bytes", () => {
  test("thin cells carry their exact count", () => {
    for (let n = 0; n <= HORDE_EXACT_MAX; n++) {
      expect(hordeDensityByte(n)).toBe(n);
      expect(hordeDensityCount(hordeDensityByte(n))).toBe(n);
    }
  });

  test("packed cells round up to their step and stay below the building bytes", () => {
    let last = HORDE_EXACT_MAX;
    for (let n = HORDE_EXACT_MAX + 1; n <= DEFAULT_CELL_CAP; n++) {
      const b = hordeDensityByte(n);
      expect(b).toBeGreaterThanOrEqual(last);
      expect(b).toBeLessThanOrEqual(HORDE_DENSITY_MAX_BYTE);
      expect(hordeDensityCount(b)).toBeGreaterThanOrEqual(n);
      last = b;
    }
    // A full cell still reads as full rather than clamping early.
    expect(hordeDensityByte(DEFAULT_CELL_CAP)).toBeLessThanOrEqual(
      HORDE_DENSITY_MAX_BYTE,
    );
    expect(hordeDensityCount(HORDE_DENSITY_MAX_BYTE)).toBeGreaterThanOrEqual(
      DEFAULT_CELL_CAP,
    );
  });
});
