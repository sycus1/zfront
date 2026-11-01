import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameMapType } from "../../packages/engine-api/src/game/Maps.gen";
import { MAP_FACTS } from "../../src/client/components/nightshift/MapFacts";

// The map picker's terrain bars must say what the map files hold. Terrain
// bytes: bit 7 land, low five bits magnitude (GameMapImpl): plains < 10,
// highland < 20, mountain and impassable from 20.
function measure(folder: string, width: number, height: number) {
  const bytes = readFileSync(`resources/maps/${folder}/map.bin`);
  const n = width * height;
  let open = 0;
  let solid = 0;
  let water = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if ((b & 0x80) === 0) water++;
    else if ((b & 0x1f) >= 20) solid++;
    else open++;
  }
  const pct = (v: number) => (100 * v) / n;
  return { open: pct(open), solid: pct(solid), water: pct(water) };
}

describe("map facts", () => {
  it("covers every map the game ships", () => {
    expect(MAP_FACTS.map((f) => f.map).sort()).toEqual(
      Object.values(GameMapType).sort(),
    );
  });

  for (const facts of MAP_FACTS) {
    it(`matches ${facts.map}'s map file`, () => {
      const folder = facts.map.toLowerCase();
      const manifest = JSON.parse(
        readFileSync(`resources/maps/${folder}/manifest.json`, "utf8"),
      );
      expect([facts.tilesWide, facts.tilesHigh]).toEqual([
        manifest.map.width,
        manifest.map.height,
      ]);
      expect(facts.metresPerTile).toBe(manifest.metres_per_tile);
      if (facts.km !== undefined && facts.metresPerTile !== undefined) {
        expect(facts.km).toBeCloseTo(
          (facts.tilesWide * facts.metresPerTile) / 1000,
        );
      }

      const measured = measure(folder, facts.tilesWide, facts.tilesHigh);
      expect(Math.abs(measured.open - facts.open)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.solid - facts.solid)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.water - facts.water)).toBeLessThanOrEqual(1);
      expect(facts.open + facts.solid + facts.water).toBeGreaterThanOrEqual(99);
      expect(facts.open + facts.solid + facts.water).toBeLessThanOrEqual(101);
    });
  }
});
