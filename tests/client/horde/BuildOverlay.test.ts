import { describe, expect, it } from "vitest";
import { buildOverlay } from "../../../src/client/render/gl/passes/HordePass";
import type { GhostPreviewData } from "../../../src/client/render/types";

function ghost(overrides: Partial<GhostPreviewData> = {}): GhostPreviewData {
  return {
    ghostType: "Wall",
    tileX: 54,
    tileY: 42,
    radiusTileX: 54,
    radiusTileY: 42,
    canBuild: true,
    canUpgrade: false,
    cost: 10_000,
    showCost: true,
    canAfford: true,
    ghostRailPaths: [],
    overlappingRailroads: [],
    ownerID: 1,
    upgradeTargetTile: null,
    rangeRadius: 0,
    rangeWarning: false,
    buildGrid: true,
    ...overrides,
  };
}

describe("build overlay", () => {
  it("centres the grid on the ghost's 2x2 cell and maps links to cells", () => {
    const overlay = buildOverlay(ghost({ wallLinks: [54, 42, 42, 42] }))!;
    expect(overlay.cursor).toEqual([27.5, 21.5]);
    expect(Array.from(overlay.links)).toEqual([27.5, 21.5, 21.5, 21.5]);
  });

  it("follows a cursor between tiles to the cell under it", () => {
    // The shader's tile convention: tile x + 0.5 is the tile's centre.
    const overlay = buildOverlay(ghost({ tileX: 55.4, tileY: 40.6 }))!;
    expect(overlay.cursor).toEqual([27.5, 20.5]);
    expect(overlay.links).toHaveLength(0);
  });

  it("is off for buildings outside the horde grid", () => {
    expect(buildOverlay(ghost({ buildGrid: false }))).toBeNull();
    expect(buildOverlay(null)).toBeNull();
  });
});
