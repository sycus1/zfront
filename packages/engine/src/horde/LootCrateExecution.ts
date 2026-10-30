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
 * zfront: a player starts looting a supply crate (HordeExecution.lootCrate).
 * Ignored outside horde mode and whenever the crate can't be looted.
 */
export class LootCrateExecution implements Execution {
  constructor(
    private player: Player,
    private crate: number,
  ) {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(game: Game, ticks: number): void {
    hordeOf(game)?.lootCrate(this.player, this.crate);
  }

  tick(ticks: number): void {}

  snapshot(w: SnapshotWriter): ExecRecord {
    return LootCrateExecutionSnapshot.write({
      player: w.player(this.player),
      crate: this.crate,
    });
  }

  restoreSnapshot(s: LootCrateState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.crate = s.crate;
  }
}

const LootCrateStateSchema = z.object({ player: zPlayerRef(), crate: zInt() });
type LootCrateState = z.infer<typeof LootCrateStateSchema>;

export const LootCrateExecutionSnapshot = execSnapshotType({
  name: "LootCrate",
  version: 1,
  schema: LootCrateStateSchema,
  cls: () => LootCrateExecution,
});
