import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";
import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  fromEverySide,
  hqHit,
  hqPercent,
  hqSegments,
  padWave,
  sectorDirections,
  waveStarted,
} from "../../../src/client/hud/HordeHudModel";

function frame(overrides: Partial<HordeFrame>): HordeFrame {
  return {
    wave: 1,
    nextWave: 2,
    nextWaveSectors: 0,
    nextWaveFinal: false,
    hqHp: 100,
    hqMaxHp: 100,
    outcome: "playing",
    ...overrides,
  } as HordeFrame;
}

describe("HordeHudModel", () => {
  it("formats countdowns and wave numbers", () => {
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(721)).toBe("1:13");
    expect(padWave(7)).toBe("07");
    expect(padWave(15)).toBe("15");
  });

  it("reads the sector mask clockwise from north", () => {
    expect(sectorDirections(0b0000_0110)).toEqual(["ne", "e"]);
    expect(sectorDirections(0)).toEqual([]);
    expect(fromEverySide(0xff, false)).toBe(true);
    expect(fromEverySide(0b11, true)).toBe(true);
    expect(fromEverySide(0b11, false)).toBe(false);
  });

  it("splits HQ health into ten blocks, keeping one while it stands", () => {
    expect(hqPercent({ hqHp: 72, hqMaxHp: 100 })).toBe(72);
    expect(hqPercent({ hqHp: 5, hqMaxHp: 0 })).toBe(0);
    expect(hqPercent({ hqHp: 150, hqMaxHp: 100 })).toBe(100);
    expect(hqSegments(72)).toBe(7);
    expect(hqSegments(100)).toBe(10);
    expect(hqSegments(2)).toBe(1);
    expect(hqSegments(0)).toBe(0);
  });

  it("spots a wave starting, with the directions announced for it", () => {
    const before = frame({ wave: 6, nextWave: 7, nextWaveSectors: 0b101 });
    expect(waveStarted(null, before)).toBeNull();
    expect(waveStarted(before, before)).toBeNull();
    expect(waveStarted(before, frame({ wave: 7, nextWave: 8 }))).toEqual({
      wave: 7,
      sectors: 0b101,
      final: false,
    });
    // A wave that wasn't the announced one carries no directions.
    expect(waveStarted(before, frame({ wave: 9 }))).toEqual({
      wave: 9,
      sectors: 0,
      final: false,
    });
    const last = frame({ wave: 9, nextWave: 10, nextWaveFinal: true });
    expect(waveStarted(last, frame({ wave: 10, nextWave: 0 }))?.final).toBe(
      true,
    );
  });

  it("spots the HQ taking damage while it stands", () => {
    const full = frame({ hqHp: 100 });
    expect(hqHit(null, full)).toBe(false);
    expect(hqHit(full, frame({ hqHp: 90 }))).toBe(true);
    expect(hqHit(full, frame({ hqHp: 100 }))).toBe(false);
    // Repairs, a fallen HQ and a finished game don't count.
    expect(hqHit(frame({ hqHp: 90 }), full)).toBe(false);
    expect(hqHit(full, frame({ hqHp: 0 }))).toBe(false);
    expect(hqHit(full, frame({ hqHp: 50, outcome: "lost" }))).toBe(false);
  });
});
