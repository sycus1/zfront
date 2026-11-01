import {
  buildDistricts,
  DistrictState,
} from "@openfront/engine-lib/game/Districts";
import { districtCells } from "../../../src/client/render/gl/passes/DistrictPass";

describe("districtCells", () => {
  test("packs each cell's district state and its borders", () => {
    const map = buildDistricts(20, 20, 10);
    const states = new Uint8Array(map.count);
    states[0] = DistrictState.Held;
    const cells = districtCells(map, 20, 20, states);
    // The top-left corner is deep in district 0, with no border.
    expect(cells[0]).toBe(DistrictState.Held);
    for (let c = 0; c < cells.length; c++) {
      const d = map.ids[c];
      expect(cells[c] & 7).toBe(states[d]);
      const x = c % 20;
      const east = x + 1 < 20 && map.ids[c + 1] !== d;
      expect((cells[c] & 16) !== 0).toBe(east);
    }
    // Some cells sit on a border between districts.
    expect(cells.some((b) => (b & 0x78) !== 0)).toBe(true);
  });
});
