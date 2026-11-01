import type { HordeFrame } from "@openfront/engine-api/game/GameUpdates";

/**
 * zfront: what the horde HUD shows, worked out from the horde frames the
 * worker sends. Pure, so the wave panel, the HQ alert and the events feed
 * share it and tests can drive it without a DOM.
 */

/** Compass points, in the order of HordeFrame.nextWaveSectors' bits. */
export const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** The blocks in the HQ health bar. */
export const HQ_SEGMENTS = 10;

/** HQ health at or under this percentage is shown in red. */
export const HQ_LOW_PERCENT = 30;

/** How long (in ticks, 10 a second) HQ UNDER ATTACK stays up after a hit. */
export const HQ_ALERT_TICKS = 30;

/** Ticks (10 per second) as m:ss. */
export function formatCountdown(ticks: number): string {
  const secs = Math.ceil(Math.max(0, ticks) / 10);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** The directions in a sector bit mask, clockwise from north. */
export function sectorDirections(mask: number): Direction[] {
  return DIRECTIONS.filter((_, k) => (mask & (1 << k)) !== 0);
}

/** True when a wave comes from every side (the final wave always does). */
export function fromEverySide(mask: number, final: boolean): boolean {
  return final || sectorDirections(mask).length === DIRECTIONS.length;
}

/** HQ health as a whole percentage, 0 to 100. */
export function hqPercent(s: Pick<HordeFrame, "hqHp" | "hqMaxHp">): number {
  if (s.hqMaxHp <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((s.hqHp / s.hqMaxHp) * 100)));
}

/** How many of the HQ bar's blocks are lit: any health left lights one. */
export function hqSegments(percent: number): number {
  if (percent <= 0) return 0;
  return Math.max(1, Math.min(HQ_SEGMENTS, Math.round(percent / 10)));
}

/** A wave number as the HUD prints it: two digits, "07". */
export function padWave(wave: number): string {
  return String(Math.max(0, wave)).padStart(2, "0");
}

/** A wave that has just begun: its number and where it comes from. */
export interface WaveStart {
  wave: number;
  sectors: number;
  final: boolean;
}

/**
 * The wave that started between two frames, or null. Its directions are the
 * ones the previous frame announced for it.
 */
export function waveStarted(
  prev: HordeFrame | null,
  next: HordeFrame,
): WaveStart | null {
  if (prev === null || next.wave <= prev.wave || next.wave < 1) return null;
  const announced = prev.nextWave === next.wave;
  return {
    wave: next.wave,
    sectors: announced ? prev.nextWaveSectors : 0,
    final: announced && prev.nextWaveFinal,
  };
}

/** True when the HQ lost health between two frames and still stands. */
export function hqHit(prev: HordeFrame | null, next: HordeFrame): boolean {
  return (
    prev !== null &&
    next.outcome === "playing" &&
    next.hqHp > 0 &&
    next.hqMaxHp === prev.hqMaxHp &&
    next.hqHp < prev.hqHp
  );
}
