import { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import {
  buildDistricts,
  DistrictState,
} from "@openfront/engine-lib/game/Districts";
import {
  districtCells,
  districtContentMarkers,
} from "../../../src/client/render/gl/passes/DistrictPass";

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

describe("districtContentMarkers", () => {
  test("reads what each district holds from the frame", () => {
    const frame = {
      // A dormant Factory with cash and survivors next to held ground,
      // and an awake City further out with nothing left to collect.
      districtContents: Int32Array.from([
        2 * 100 + 7,
        5_000,
        20_000,
        2,
        0,
        1,
        40 * 100 + 9,
        0,
        0,
        1,
        1,
        0,
      ]),
    } as unknown as HordeFrame;
    expect(districtContentMarkers(frame, 100)).toEqual([
      {
        tile: 207,
        x: 7,
        y: 2,
        cash: 5_000,
        survivors: 20_000,
        unitType: "Factory",
        kind: 2,
        awake: false,
        near: true,
      },
      {
        tile: 4009,
        x: 9,
        y: 40,
        cash: 0,
        survivors: 0,
        unitType: "City",
        kind: 1,
        awake: true,
        near: false,
      },
    ]);
  });
});
