import { GameID } from "@openfront/engine-api/Schemas";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
//import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { Game } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";

const gameID: GameID = "game_id";
let game: Game;
let defenderSpawn: TileRef;
let attackerSpawn: TileRef;

describe("GameImpl", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });
    const attackerInfo = new PlayerInfo(
      "attacker dude",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerInfo);
    const defenderInfo = new PlayerInfo(
      "defender dude",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);

    defenderSpawn = game.ref(0, 15);
    attackerSpawn = game.ref(0, 14);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(attackerInfo.id).info(),
        attackerSpawn,
      ),
      new SpawnExecution(
        gameID,
        game.player(defenderInfo.id).info(),
        defenderSpawn,
      ),
    );
  });

  test("Singleplayer late human spawn gets spawn immunity", async () => {
    const singleplayerGame = await setup(
      "plains",
      {
        gameType: GameType.Singleplayer,
      },
      [],
      undefined,
      undefined,
      false,
    );
    (singleplayerGame.config() as any).setSpawnImmunityDuration(100);

    const pastSpawnCountdown =
      singleplayerGame.config().numSpawnPhaseTurns() + 20;
    for (let i = 0; i < pastSpawnCountdown; i++) {
      singleplayerGame.executeNextTick();
    }

    const lateHumanInfo = new PlayerInfo(
      "late human",
      PlayerType.Human,
      "late_client_id",
      "late_player_id",
    );

    singleplayerGame.addExecution(
      new SpawnExecution(gameID, lateHumanInfo, singleplayerGame.ref(5, 5)),
    );

    // First tick initializes the execution, second tick applies the spawn.
    singleplayerGame.executeNextTick();
    const spawnUpdates = singleplayerGame.executeNextTick();

    expect(singleplayerGame.player(lateHumanInfo.id).hasSpawned()).toBe(true);
    expect(spawnUpdates[GameUpdateType.SpawnPhaseEnd]).toHaveLength(1);
    expect(singleplayerGame.isSpawnImmunityActive()).toBe(true);
  });
});
