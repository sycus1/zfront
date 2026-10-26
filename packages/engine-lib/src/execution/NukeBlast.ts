import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { Structures } from "@openfront/engine-api/game/GameTypes";
import { GameLike } from "@openfront/engine-api/game/ReadViews";
import { NukeMagnitude } from "../configuration/Config";

export interface NukeBlastParams {
  gm: GameMap;
  targetTile: TileRef;
  magnitude: NukeMagnitude;
}

/**
 * Counts how many tiles each player has in the nuke's blast zone.
 *
 * returns Map of player ID and weighted tile count
 */
export function computeNukeBlastCounts(
  params: NukeBlastParams,
): Map<number, number> {
  const { gm, targetTile, magnitude } = params;

  const inner2 = magnitude.inner * magnitude.inner;
  const counts = new Map<number, number>();

  gm.circleSearch(targetTile, magnitude.outer, (tile: TileRef, d2: number) => {
    const ownerSmallId = gm.ownerID(tile);
    if (ownerSmallId > 0) {
      const weight = d2 <= inner2 ? 1 : 0.5;
      const prev = counts.get(ownerSmallId) ?? 0;
      counts.set(ownerSmallId, prev + weight);
    }
    return true;
  });

  return counts;
}

export interface NukeAngerParams {
  game: GameLike;
  targetTile: TileRef;
  magnitude: NukeMagnitude;
  threshold: number;
}

// Finds every player that would be "angered" by this nuke: those whose
// weighted tile count in the blast exceeds the threshold, or who own a
// structure in the blast radius.
export function listNukeAngeredPlayers(params: NukeAngerParams): Set<number> {
  const { game, targetTile, magnitude, threshold } = params;

  const angered = new Set<number>();

  // compute tile breakage threshold
  const blastCounts = computeNukeBlastCounts({
    gm: game,
    targetTile,
    magnitude,
  });
  for (const [playerSmallId, totalWeight] of blastCounts) {
    if (totalWeight > threshold) {
      angered.add(playerSmallId);
    }
  }

  // Also anger anyone whose structures would be destroyed
  game
    .nearbyUnits(targetTile, magnitude.outer, Structures.types)
    .forEach(({ unit }) => angered.add(unit.owner().smallID()));

  return angered;
}
