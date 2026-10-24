import {
  ColoredTeams,
  GameMode,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  Quads,
  Team,
} from "@openfront/engine-api/game/GameTypes";
import { Game } from "@openfront/engine/game/Game";
import { describe, expect, test } from "vitest";
import { setup } from "../../util/Setup";

describe("Core Simulation - Team Resolution and Assignment", () => {
  function playerTeamsOf(game: Game): Team[] {
    return game.teams().filter((t) => t !== ColoredTeams.Bot);
  }

  function createHuman(id: string): PlayerInfo {
    return new PlayerInfo(
      `Player ${id}`,
      PlayerType.Human,
      `client_${id}`,
      `p_${id}`,
      false,
    );
  }

  test("GameImpl resolves 2 teams and balances an odd roster", async () => {
    const players = Array.from({ length: 7 }, (_, i) => createHuman(`p${i}`));

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
      players,
    );

    // GameImpl constructor must have called resolveTeamsList(2, 7)
    expect(playerTeamsOf(game)).toEqual([ColoredTeams.Red, ColoredTeams.Blue]);

    // All 7 players must be in the game (no simulation kicks), split 4/3.
    expect(game.allPlayers()).toHaveLength(7);
    const onRed = players.filter(
      (p) => game.player(p.id).team() === ColoredTeams.Red,
    );
    expect(onRed).toHaveLength(4);
  });

  test("GameImpl dynamically resolves the Quads team count from attendance", async () => {
    const roster = Array.from({ length: 8 }, (_, i) => createHuman(`q${i}`));

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: Quads,
        nations: "disabled",
      },
      roster,
    );

    // 8 players in Quads -> Math.ceil(8 / 4) = 2 teams (Red, Blue)
    expect(playerTeamsOf(game)).toHaveLength(2);
    expect(playerTeamsOf(game)).toEqual([ColoredTeams.Red, ColoredTeams.Blue]);

    // All 8 players must be placed without tick-0 kicks
    expect(game.allPlayers()).toHaveLength(8);
  });

  test("GameImpl resolves numbered teams when playerTeams >= 8", async () => {
    const players = Array.from({ length: 16 }, (_, i) => createHuman(`${i}`));

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 8,
        nations: "disabled",
      },
      players,
    );

    expect(playerTeamsOf(game)).toHaveLength(8);
    expect(playerTeamsOf(game)).toEqual([
      "Team 1",
      "Team 2",
      "Team 3",
      "Team 4",
      "Team 5",
      "Team 6",
      "Team 7",
      "Team 8",
    ]);
    expect(game.allPlayers()).toHaveLength(16);
  });

  test("GameImpl resolves HumansVsNations teams", async () => {
    const humans = Array.from({ length: 4 }, (_, i) => createHuman(`h${i}`));

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: HumansVsNations,
        nations: 2,
      },
      humans,
    );

    expect(playerTeamsOf(game)).toEqual([
      ColoredTeams.Humans,
      ColoredTeams.Nations,
    ]);

    for (const h of humans) {
      expect(game.player(h.id).team()).toBe(ColoredTeams.Humans);
    }
  });
});
