/**
 * zfront: relief by rail and by sea (stage 5 of the district plan in
 * docs/zfront/spike-plan.md). A town map can name its railway station and
 * its harbour. The district each one stands in holds a dormant building
 * there (DistrictContents): the station wakes as a Factory, the rail hub
 * whose track reaches the Cities you hold, and the harbour as a Port. Every
 * `reliefEvery` waves, when the wave is cleared, each of them that is
 * awake brings its holder `reliefSurvivors` people and `reliefGold` gold:
 * a relief train or boat from outside the town. The horde goes for them
 * like any building; one it wrecks misses that relief and is rebuilt for
 * its holder once the wave is cleared.
 */

export interface ReliefOptions {
  /** Relief comes after every this many waves; 0: never. */
  reliefEvery: number;
  /** People and gold each held station or harbour brings. */
  reliefSurvivors: number;
  reliefGold: number;
  /**
   * The railway station's tile, or -1: the dormant station stands on the
   * nearest open land tile to it.
   */
  reliefStationX: number;
  reliefStationY: number;
  /**
   * Near the harbour, or -1: the dormant harbour stands on the nearest
   * open sea-shore tile to it, within `RELIEF_HARBOUR_REACH` tiles.
   */
  reliefHarbourX: number;
  reliefHarbourY: number;
}

/** How far from the given spot a station's tile may be, in tiles. */
export const RELIEF_STATION_REACH = 8;
/** How far from the given spot a harbour's shore tile may be, in tiles. */
export const RELIEF_HARBOUR_REACH = 40;

/** Whether relief comes once wave `wave` is cleared. */
export function reliefAfter(opts: ReliefOptions, wave: number): boolean {
  return opts.reliefEvery > 0 && wave > 0 && wave % opts.reliefEvery === 0;
}

/**
 * The wave after whose clear the next relief comes, with `survived` waves
 * survived so far; 0 when relief never comes.
 */
export function nextReliefWave(opts: ReliefOptions, survived: number): number {
  if (opts.reliefEvery <= 0) return 0;
  return (Math.floor(survived / opts.reliefEvery) + 1) * opts.reliefEvery;
}

/**
 * The tile nearest (`x`, `y`) within `reach` tiles that passes `ok`,
 * nearest first, then top to bottom, left to right; null when none does.
 */
export function nearestTile(
  x: number,
  y: number,
  reach: number,
  width: number,
  height: number,
  ok: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (
    let ty = Math.max(0, y - reach);
    ty <= Math.min(height - 1, y + reach);
    ty++
  ) {
    for (
      let tx = Math.max(0, x - reach);
      tx <= Math.min(width - 1, x + reach);
      tx++
    ) {
      const d = (tx - x) * (tx - x) + (ty - y) * (ty - y);
      if (d > reach * reach || d >= bestD || !ok(tx, ty)) continue;
      best = { x: tx, y: ty };
      bestD = d;
    }
  }
  return best;
}
