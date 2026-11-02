import { TileRef } from "@openfront/engine-api/game/GameMap";
import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { hordeOf } from "./HordeExecution";

/**
 * zfront: a player raises the border walls of one of their districts a
 * tier (HordeExecution.upgradeDistrictWalls). Ignored outside horde mode
 * and whenever the walls can't be upgraded.
 */
export class UpgradeWallsExecution implements Execution {
  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(game: Game, ticks: number): void {
    hordeOf(game)?.upgradeDistrictWalls(this.player, this.tile);
  }

  tick(ticks: number): void {}

  snapshot(w: SnapshotWriter): ExecRecord {
    return UpgradeWallsExecutionSnapshot.write({
      player: w.player(this.player),
      tile: this.tile,
    });
  }

  restoreSnapshot(s: UpgradeWallsState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.tile = s.tile as TileRef;
  }
}

const UpgradeWallsStateSchema = z.object({
  player: zPlayerRef(),
  tile: zInt(),
});
type UpgradeWallsState = z.infer<typeof UpgradeWallsStateSchema>;

export const UpgradeWallsExecutionSnapshot = execSnapshotType({
  name: "UpgradeWalls",
  version: 1,
  schema: UpgradeWallsStateSchema,
  cls: () => UpgradeWallsExecution,
});
