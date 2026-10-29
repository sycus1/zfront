import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
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
 * zfront: a player calls the announced horde wave early
 * (HordeExecution.callWave). Ignored outside horde mode and whenever the
 * wave can't be called.
 */
export class CallWaveExecution implements Execution {
  constructor(private player: Player) {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(game: Game, ticks: number): void {
    hordeOf(game)?.callWave(this.player);
  }

  tick(ticks: number): void {}

  snapshot(w: SnapshotWriter): ExecRecord {
    return CallWaveExecutionSnapshot.write({ player: w.player(this.player) });
  }

  restoreSnapshot(s: CallWaveState, r: SnapshotReader): void {
    this.player = r.player(s.player);
  }
}

const CallWaveStateSchema = z.object({ player: zPlayerRef() });
type CallWaveState = z.infer<typeof CallWaveStateSchema>;

export const CallWaveExecutionSnapshot = execSnapshotType({
  name: "CallWave",
  version: 1,
  schema: CallWaveStateSchema,
  cls: () => CallWaveExecution,
});
