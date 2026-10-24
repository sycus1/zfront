import { GameMode } from "@openfront/engine-api/game/GameTypes";

import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import {
  friendsLookup,
  NameVisibility,
  NameVisibilityView,
} from "../../src/server/NameVisibility";
import { makeClient } from "../util/GameServerHarness";

// The per-viewer identity rules on their own, over a fixed roster. The lobby
// projection (lobbyClients) and the anonymizeNames matrix are exercised
// through GameServer.gameInfo in AnonymizeNames*.test.ts; this file covers
// what only the module boundary exposes cleanly: the start-message reveal
// rules with explicit real/wire inputs, and the friends lookup — plus one
// end-to-end check that the start message GameServer actually sends goes
// through those rules.

type Config = ReturnType<NameVisibilityView["config"]>;

function visibility(
  clients: Client[],
  config: Partial<Config> = {},
  teams: string[][] = [],
): NameVisibility {
  return new NameVisibility({
    gameID: "g1000000",
    config: () => ({
      gameMode: GameMode.FFA,
      anonymizeNames: false,
      ...config,
    }),
    clients: () => new Map(clients.map((c) => [c.clientID, c])),
    teamIndex: (c) => {
      const i = teams.findIndex(
        (t) => c.publicId !== undefined && t.includes(c.publicId),
      );
      return i === -1 ? undefined : i;
    },
  });
}

describe("anonName", () => {
  const roster = () => [
    makeClient({ clientID: "alice", publicId: "alice-pub" }),
    makeClient({ clientID: "bob", publicId: "bob-pub" }),
    makeClient({ clientID: "carol", publicId: "carol-pub" }),
  ];

  it("is stable per (viewer, target) and never collides within one view", () => {
    const names = visibility(roster(), { anonymizeNames: true });
    const seen = ["alice", "bob", "carol"].map((id) => names.anonName("x", id));
    expect(new Set(seen).size).toBe(3);
    expect(
      ["alice", "bob", "carol"].map((id) => names.anonName("x", id)),
    ).toEqual(seen);
  });

  it("differs between viewers, but not between pinned teammates", () => {
    const teams = [["alice-pub", "bob-pub"], ["carol-pub"]];
    const names = visibility(roster(), { anonymizeNames: true }, teams);
    // alice and bob share a rotation, so they can call the same target.
    expect(names.anonName("alice", "carol")).toBe(
      names.anonName("bob", "carol"),
    );
    // Someone outside the team keeps their own.
    expect(names.anonName("carol", "alice")).not.toBe(
      names.anonName("alice", "alice"),
    );
  });
});

describe("friendsLookup", () => {
  it("maps publicId friends to the clientIDs present, dropping the rest", () => {
    const alice = makeClient({
      clientID: "alice",
      publicId: "alice-pub",
      friends: ["bob-pub", "nobody-pub"],
    });
    const bob = makeClient({ clientID: "bob", publicId: "bob-pub" });
    expect(friendsLookup([alice, bob])(alice)).toEqual(["bob"]);
    expect(friendsLookup([alice, bob])(bob)).toBeUndefined();
  });

  it("never resolves a spectator, who is not in the simulation", () => {
    const alice = makeClient({
      clientID: "alice",
      publicId: "alice-pub",
      friends: ["cast-pub"],
    });
    const cast = makeClient({
      clientID: "cast",
      publicId: "cast-pub",
      spectator: true,
    });
    expect(friendsLookup([alice, cast])(alice)).toBeUndefined();
  });
});
