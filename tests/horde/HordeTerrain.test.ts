import {
  HORDE_BLOCKED_MAGNITUDE,
  hordeMoveCost,
  isWallAnchorTerrain,
} from "@openfront/engine-lib/game/HordeTerrain";
import { buildCostField } from "@openfront/engine/horde/HordeField";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";

const land = (mag: number, shore = false) => 0x80 | (shore ? 0x40 : 0) | mag;
const water = (depth: number) => 0x20 | depth;

describe("HordeTerrain", () => {
  it("costs more on higher ground and blocks at the blocked magnitude", () => {
    expect(hordeMoveCost(land(0))).toBe(1);
    expect(hordeMoveCost(land(4, true))).toBe(2);
    expect(hordeMoveCost(land(HORDE_BLOCKED_MAGNITUDE - 1))).toBe(5);
    expect(hordeMoveCost(land(HORDE_BLOCKED_MAGNITUDE))).toBe(0);
    expect(hordeMoveCost(land(30))).toBe(0);
  });

  it("blocks water and impassable terrain whatever the blocked magnitude", () => {
    expect(hordeMoveCost(water(3))).toBe(0);
    expect(hordeMoveCost(land(31), 32)).toBe(0);
    expect(hordeMoveCost(land(25), 32)).toBe(7);
  });

  it("anchors walls on blocked land but not on water", () => {
    expect(isWallAnchorTerrain(land(22))).toBe(true);
    expect(isWallAnchorTerrain(land(31))).toBe(true);
    expect(isWallAnchorTerrain(land(10))).toBe(false);
    expect(isWallAnchorTerrain(water(0))).toBe(false);
  });

  it("is the rule the horde's cost field uses", async () => {
    const game = await setup("half_land_half_ocean", {});
    const map = game.miniMap();
    const cost = buildCostField(map, HORDE_BLOCKED_MAGNITUDE);
    let open = 0;
    let blocked = 0;
    map.forEachTile((t) => {
      const c = hordeMoveCost(map.terrainByte(t));
      expect(cost[t]).toBe(c);
      if (c === 0) blocked++;
      else open++;
    });
    expect(open).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });
});
