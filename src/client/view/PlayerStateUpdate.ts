import { PlayerUpdate } from "@openfront/engine-api/game/GameUpdates";
import type { PlayerState } from "../render/types";

/**
 * Merge a partial PlayerUpdate into a long-lived PlayerState in place.
 *
 * Only fields present on `pu` are applied; `undefined` means "no change since
 * last emission". The first emission per player carries every field, so the
 * target state is fully populated after one merge of the initial update.
 */
export function applyStateUpdate(target: PlayerState, pu: PlayerUpdate): void {
  // smallID is identity — never changes for a given player.
  if (pu.isAlive !== undefined) target.isAlive = pu.isAlive;
  if (pu.isDisconnected !== undefined)
    target.isDisconnected = pu.isDisconnected;
  if (pu.killedBy !== undefined) target.killedBy = pu.killedBy;
  if (pu.deathPosition !== undefined) target.deathPosition = pu.deathPosition;
  if (pu.tilesOwned !== undefined) target.tilesOwned = pu.tilesOwned;
  if (pu.gold !== undefined) target.gold = Number(pu.gold);
  if (pu.tradeGold !== undefined) target.tradeGold = Number(pu.tradeGold);
  if (pu.trainGold !== undefined) target.trainGold = Number(pu.trainGold);
  if (pu.piracyGold !== undefined) target.piracyGold = Number(pu.piracyGold);
  if (pu.goldEarned !== undefined) target.goldEarned = Number(pu.goldEarned);
  if (pu.troops !== undefined) target.troops = pu.troops;
  if (pu.inDoomsdayClock !== undefined)
    target.inDoomsdayClock = pu.inDoomsdayClock;
  if (pu.markedDoomsdayClockTick !== undefined) {
    target.markedDoomsdayClockTick = pu.markedDoomsdayClockTick;
  }
  if (pu.isDecaying !== undefined) target.isDecaying = pu.isDecaying;
  if (pu.hasSpawned !== undefined) target.hasSpawned = pu.hasSpawned;
  if (pu.spawnTile !== undefined) target.spawnTile = pu.spawnTile;
  if (pu.lastDeleteUnitTick !== undefined) {
    target.lastDeleteUnitTick = pu.lastDeleteUnitTick;
  }
  // Slice() to detach from the wire object — accumulated state mustn't share
  // mutable arrays with per-tick update payloads.
  if (pu.targets !== undefined) target.targets = pu.targets.slice();
  if (pu.outgoingAttacks !== undefined) {
    target.outgoingAttacks = pu.outgoingAttacks;
  }
  if (pu.incomingAttacks !== undefined) {
    target.incomingAttacks = pu.incomingAttacks;
  }
  if (pu.outgoingEmojis !== undefined)
    target.outgoingEmojis = pu.outgoingEmojis;
}
