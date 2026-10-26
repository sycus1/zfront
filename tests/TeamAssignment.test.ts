import {
  ColoredTeams,
  Duos,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  Quads,
  Trios,
} from "@openfront/engine-api/game/GameTypes";
import {
  assignTeams,
  resolveTeamsList,
} from "@openfront/engine-lib/game/TeamAssignment";

const teams = [ColoredTeams.Red, ColoredTeams.Blue];

describe("assignTeams", () => {
  const createPlayer = (id: string): PlayerInfo => {
    return new PlayerInfo(
      `Player ${id}`,
      PlayerType.Human,
      null, // clientID (null for testing)
      id,
      false,
    );
  };

  // Friend grouping is keyed on clientID. By default we pass clientID = id
  // for brevity, but tests can override clientID to verify the lookup uses
  // clientID rather than PlayerInfo.id.
  const createPlayerWithFriends = (
    id: string,
    friends: string[],
    clientID: string = id,
  ): PlayerInfo => {
    return new PlayerInfo(
      `Player ${id}`,
      PlayerType.Human,
      clientID,
      id, // PlayerInfo.id
      false,
      friends,
    );
  };

  it("should assign players to teams alternately", () => {
    const players = [
      createPlayer("1"),
      createPlayer("2"),
      createPlayer("3"),
      createPlayer("4"),
    ];

    const result = assignTeams(players, teams, false);

    // Check that players are assigned alternately
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[2])).toEqual(ColoredTeams.Red);
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
  });

  it("should handle empty player list", () => {
    const result = assignTeams([], teams, false);
    expect(result.size).toBe(0);
  });

  it("should handle single player", () => {
    const players = [createPlayer("1")];
    const result = assignTeams(players, teams, false);
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
  });

  it("should distribute players among a larger number of teams", () => {
    const players = Array.from({ length: 14 }, (_, i) => createPlayer(`${i}`));
    const sevenTeams = [
      ColoredTeams.Red,
      ColoredTeams.Blue,
      ColoredTeams.Yellow,
      ColoredTeams.Green,
      ColoredTeams.Purple,
      ColoredTeams.Orange,
      ColoredTeams.Teal,
    ];

    const result = assignTeams(players, sevenTeams, false);

    // Round-robin: every team gets exactly two players, nobody is kicked.
    for (const team of sevenTeams) {
      expect([...result.values()].filter((t) => t === team)).toHaveLength(2);
    }
    expect([...result.values()]).not.toContain("kicked");
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[7])).toEqual(ColoredTeams.Red);
  });

  it("should keep two friends on the same team", () => {
    const players = [
      createPlayerWithFriends("1", ["2"]),
      createPlayerWithFriends("2", ["1"]),
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[0])).toEqual(result.get(players[1]));
    expect(result.get(players[2])).not.toEqual(result.get(players[0]));
    expect(result.get(players[3])).not.toEqual(result.get(players[0]));
  });

  it("should group a chain of friends transitively", () => {
    // 6 players, 2 teams → maxTeamSize = 3 (enough room for a 3-friend chain)
    const players = [
      createPlayerWithFriends("1", ["2"]),
      createPlayerWithFriends("2", ["3"]),
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
      createPlayerWithFriends("5", []),
      createPlayerWithFriends("6", []),
    ];

    const result = assignTeams(players, teams, false);

    const teamOf1 = result.get(players[0]);
    expect(result.get(players[1])).toEqual(teamOf1);
    expect(result.get(players[2])).toEqual(teamOf1);
  });

  it("should treat one-directional friendship as a group", () => {
    const players = [
      createPlayerWithFriends("1", ["2"]),
      createPlayerWithFriends("2", []), // doesn't list 1 back
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[0])).toEqual(result.get(players[1]));
  });

  it("should spill friend-group overflow to other teams (no kicks)", () => {
    // 4-player friend group + 2 strangers, maxTeamSize = ceil(6/2) = 3.
    // Friend overflow spills to the other team rather than getting kicked.
    const players = [
      createPlayerWithFriends("1", ["2", "3", "4"]),
      createPlayerWithFriends("2", []),
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
      createPlayerWithFriends("5", []),
      createPlayerWithFriends("6", []),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual(ColoredTeams.Red);
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[4])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[5])).toEqual(ColoredTeams.Blue);
  });

  it("should key friend grouping on clientID, not PlayerInfo.id", () => {
    // clientID and PlayerInfo.id are distinct. The friends list references
    // clientIDs ("client-2", "client-1"). If grouping ever regressed to
    // keying on PlayerInfo.id ("player-1"/"player-2"), no edges would form
    // and these two would land on opposite teams.
    const players = [
      createPlayerWithFriends("player-1", ["client-2"], "client-1"),
      createPlayerWithFriends("player-2", ["client-1"], "client-2"),
      createPlayerWithFriends("player-3", [], "client-3"),
      createPlayerWithFriends("player-4", [], "client-4"),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[0])).toEqual(result.get(players[1]));
    expect(result.get(players[2])).not.toEqual(result.get(players[0]));
    expect(result.get(players[3])).not.toEqual(result.get(players[0]));
  });

  // Matchmade games: the server pins each player to a team slot via
  // PlayerInfo.teamIndex and the matcher's split must be honored verbatim.
  const createPinnedPlayer = (
    id: string,
    teamIndex: number | null,
    friends: string[] = [],
  ): PlayerInfo => {
    return new PlayerInfo(
      `Player ${id}`,
      PlayerType.Human,
      id, // clientID
      id,
      false,
      friends,
      teamIndex,
    );
  };

  it("should honor pinned teamIndex exactly (matchmade 2v2)", () => {
    const players = [
      createPinnedPlayer("1", 0),
      createPinnedPlayer("2", 1),
      createPinnedPlayer("3", 1),
      createPinnedPlayer("4", 0),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[2])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[3])).toEqual(ColoredTeams.Red);
  });

  it("should balance unpinned players around pinned ones", () => {
    // Red already holds two pinned players (at capacity for 4 players /
    // 2 teams), so the unpinned player must land on Blue.
    const players = [
      createPinnedPlayer("1", 0),
      createPinnedPlayer("2", 0),
      createPinnedPlayer("3", 1),
      createPinnedPlayer("4", null),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
  });

  it("should treat an out-of-range teamIndex as unpinned", () => {
    const players = [
      createPinnedPlayer("1", 7),
      createPinnedPlayer("2", null),
      createPinnedPlayer("3", null),
      createPinnedPlayer("4", null),
    ];

    const result = assignTeams(players, teams, false);

    for (const p of players) {
      expect([ColoredTeams.Red, ColoredTeams.Blue]).toContain(result.get(p));
    }
  });

  it("should pull an unpinned friend toward a pinned player's team", () => {
    const players = [
      createPinnedPlayer("1", 0),
      createPinnedPlayer("2", null, ["1"]),
      createPinnedPlayer("3", null),
      createPinnedPlayer("4", null),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
  });

  it("should honor pins even past maxTeamSize (trust the matcher)", () => {
    const players = [
      createPinnedPlayer("1", 0),
      createPinnedPlayer("2", 0),
      createPinnedPlayer("3", 0),
    ];

    const result = assignTeams(players, teams, false);

    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual(ColoredTeams.Red);
  });

  // In duos/trios/quads mode humans pack onto a team and nations fill the rest.
  const createNation = (id: string): PlayerInfo => {
    return new PlayerInfo(`Nation ${id}`, PlayerType.Nation, null, id, false);
  };

  for (const mode of [
    { name: "duos", size: 2 },
    { name: "trios", size: 3 },
    { name: "quads", size: 4 },
  ]) {
    it(`should fill one team with humans before putting nations on the other (${mode.name})`, () => {
      const humans = Array.from({ length: mode.size }, (_, i) =>
        createPlayer(`${i + 1}`),
      );
      const nations = Array.from({ length: mode.size }, (_, i) =>
        createNation(`${i + 1}`),
      );
      const players = [...humans, ...nations];

      const result = assignTeams(players, teams, true, mode.size);

      for (const h of humans) {
        expect(result.get(h)).toEqual(ColoredTeams.Red);
      }
      for (const n of nations) {
        expect(result.get(n)).toEqual(ColoredTeams.Blue);
      }
    });
  }

  it("should fill team gaps with humans before placing nations (trios)", () => {
    // 4 humans + 2 nations, 2 teams, maxTeamSize 3.
    // Red packs to 3 humans, Blue holds 1 human + 2 nations.
    const humans = Array.from({ length: 4 }, (_, i) =>
      createPlayer(`${i + 1}`),
    );
    const nations = Array.from({ length: 2 }, (_, i) =>
      createNation(`${i + 1}`),
    );
    const players = [...humans, ...nations];

    const result = assignTeams(players, teams, true, 3);

    const redHumans = humans.filter((h) => result.get(h) === ColoredTeams.Red);
    const blueHumans = humans.filter(
      (h) => result.get(h) === ColoredTeams.Blue,
    );
    expect(redHumans.length).toBe(3);
    expect(blueHumans.length).toBe(1);
    for (const n of nations) {
      expect(result.get(n)).toEqual(ColoredTeams.Blue);
    }
  });
});

describe("resolveTeamsList", () => {
  it("derives the team count from attendance for named modes", () => {
    expect(resolveTeamsList(Duos, 10)).toHaveLength(5);
    expect(resolveTeamsList(Trios, 9)).toHaveLength(3);
    expect(resolveTeamsList(Quads, 12)).toHaveLength(3);
  });

  // Public lobbies start on their countdown regardless of attendance, so
  // named modes must never resolve below 2 teams: with 0-2 players a Duos
  // game used to throw "Too few teams" and no client could construct the
  // game at all.
  for (const { config, size } of [
    { config: Duos, size: 2 },
    { config: Trios, size: 3 },
    { config: Quads, size: 4 },
  ]) {
    it(`clamps ${config} to 2 teams when attendance can't fill two`, () => {
      for (const totalPlayers of [0, 1, size]) {
        expect(resolveTeamsList(config, totalPlayers)).toEqual([
          ColoredTeams.Red,
          ColoredTeams.Blue,
        ]);
      }
    });
  }

  it("always resolves HumansVsNations to its two fixed teams", () => {
    expect(resolveTeamsList(HumansVsNations, 0)).toEqual([
      ColoredTeams.Humans,
      ColoredTeams.Nations,
    ]);
  });

  it("keeps numeric configs verbatim, independent of attendance", () => {
    expect(resolveTeamsList(7, 3)).toHaveLength(7);
  });

  it("still rejects a numeric config below 2 (misconfiguration)", () => {
    // A Team game with playerTeams unset resolves to 0 via
    // Config.playerTeams(); that must stay a loud error.
    expect(() => resolveTeamsList(0, 50)).toThrow("Too few teams: 0");
    expect(() => resolveTeamsList(1, 50)).toThrow("Too few teams: 1");
  });
});
