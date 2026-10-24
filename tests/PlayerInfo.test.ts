import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";

describe("PlayerInfo", () => {
  test("displays the bare name", () => {
    const playerInfo = new PlayerInfo(
      "PlayerName",
      PlayerType.Human,
      null,
      "player_id",
    );
    expect(playerInfo.displayName).toBe("PlayerName");
  });
});
