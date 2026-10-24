import {
  isTemporaryUsername,
  PlayerProfileSchema,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";

describe("UserMeResponseSchema ban", () => {
  const ban = UserMeResponseSchema.shape.ban;

  it("accepts an active temporary ban", () => {
    const r = ban.safeParse({
      category: "cheating",
      reason: "aimbot in ranked",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a permanent ban (null reason and expiry)", () => {
    const r = ban.safeParse({
      category: "other",
      reason: null,
      expiresAt: null,
    });
    expect(r.success).toBe(true);
  });

  it("treats null and a missing field as 'no ban'", () => {
    expect(ban.safeParse(null).success).toBe(true);
    expect(ban.safeParse(undefined).success).toBe(true);
  });

  it("rejects a ban with no category", () => {
    expect(ban.safeParse({ reason: null, expiresAt: null }).success).toBe(
      false,
    );
  });
});

describe("PlayerProfileSchema", () => {
  const base = {
    createdAt: "2024-01-15T12:00:00.000Z",
    stats: {},
  };

  it("accepts a profile without a games array (moved to its own endpoint)", () => {
    const result = PlayerProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("ignores a legacy games field rather than failing the parse", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      games: [{ gameId: "g1" }],
    });
    // Zod strips unknown keys by default, so an old server response that still
    // carries games[] parses cleanly without the field surfacing.
    expect(result.success).toBe(true);
    if (result.success) {
      expect("games" in result.data).toBe(false);
    }
  });

  it("rejects a non-ISO createdAt", () => {
    expect(
      PlayerProfileSchema.safeParse({ ...base, createdAt: "yesterday" })
        .success,
    ).toBe(false);
  });

  it("accepts a pre-rendered account username", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      username: "bob.4821",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("bob.4821");
    }
  });

  it("accepts username: null (player never set one)", () => {
    const result = PlayerProfileSchema.safeParse({ ...base, username: null });
    expect(result.success).toBe(true);
  });

  it("accepts a profile without username (older API)", () => {
    const result = PlayerProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBeUndefined();
    }
  });
});

describe("PlayerProfileSchema clans", () => {
  const base = {
    createdAt: "2024-01-15T12:00:00.000Z",
    stats: {},
  };
  const clan = {
    tag: "ALP",
    name: "Alpha Clan",
    role: "leader",
    joinedAt: "2024-02-01T12:00:00.000Z",
    memberCount: 12,
  };

  it("accepts a profile carrying clan memberships", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      clans: [clan, { ...clan, tag: "ZET", role: "member", memberCount: 1 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans).toHaveLength(2);
      expect(result.data.clans?.[0].role).toBe("leader");
      expect(result.data.clans?.[1].memberCount).toBe(1);
    }
  });

  it("accepts a profile without clans (older API)", () => {
    const result = PlayerProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans).toBeUndefined();
    }
  });

  it("accepts an empty clan list", () => {
    const result = PlayerProfileSchema.safeParse({ ...base, clans: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans).toEqual([]);
    }
  });

  it.each(["owner", "admin", "Leader", ""])(
    "rejects the unknown role %j",
    (role) => {
      expect(
        PlayerProfileSchema.safeParse({ ...base, clans: [{ ...clan, role }] })
          .success,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1.5, "12", null])(
    "rejects the invalid memberCount %j",
    (memberCount) => {
      expect(
        PlayerProfileSchema.safeParse({
          ...base,
          clans: [{ ...clan, memberCount }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects a clan tag outside the clan-tag charset/length", () => {
    // ClanTagSchema: 2-5 uppercase alphanumerics.
    for (const tag of ["a", "toolongtag", "a b", ""]) {
      expect(
        PlayerProfileSchema.safeParse({ ...base, clans: [{ ...clan, tag }] })
          .success,
      ).toBe(false);
    }
  });

  it("rejects a non-ISO joinedAt", () => {
    expect(
      PlayerProfileSchema.safeParse({
        ...base,
        clans: [{ ...clan, joinedAt: "last tuesday" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a clan entry missing required fields", () => {
    expect(
      PlayerProfileSchema.safeParse({ ...base, clans: [{ tag: "ALP" }] })
        .success,
    ).toBe(false);
  });

  it("keeps clan balances as strings rather than coercing to numbers", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      clans: [{ ...clan, softBalance: "1000", hardBalance: "0" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans?.[0].softBalance).toBe("1000");
      expect(result.data.clans?.[0].hardBalance).toBe("0");
    }
  });

  it("preserves a balance beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const huge = "9007199254740993";
    const result = PlayerProfileSchema.safeParse({
      ...base,
      clans: [{ ...clan, softBalance: huge, hardBalance: huge }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans?.[0].softBalance).toBe(huge);
    }
  });

  it("accepts a clan entry without balances (older API)", () => {
    const result = PlayerProfileSchema.safeParse({ ...base, clans: [clan] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans?.[0].softBalance).toBeUndefined();
      expect(result.data.clans?.[0].hardBalance).toBeUndefined();
    }
  });

  it("rejects numeric balances", () => {
    expect(
      PlayerProfileSchema.safeParse({
        ...base,
        clans: [{ ...clan, softBalance: 1000 }],
      }).success,
    ).toBe(false);
  });
});

describe("UserMeResponseSchema clan balances", () => {
  const clans = UserMeResponseSchema.shape.player.shape.clans;
  const clan = {
    tag: "ALP",
    name: "Alpha Clan",
    role: "leader",
    joinedAt: "2024-02-01T12:00:00.000Z",
    memberCount: 12,
  };

  it("keeps balances as strings on the caller's own clans", () => {
    const r = clans.safeParse([
      { ...clan, softBalance: "150", hardBalance: "25" },
    ]);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data?.[0].softBalance).toBe("150");
      expect(r.data?.[0].hardBalance).toBe("25");
    }
  });

  it("accepts clans without balances (older API)", () => {
    const r = clans.safeParse([clan]);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data?.[0].softBalance).toBeUndefined();
    }
  });

  it("rejects numeric balances", () => {
    expect(clans.safeParse([{ ...clan, hardBalance: 25 }]).success).toBe(false);
  });
});

describe("UserMeResponseSchema rewards", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a player with unclaimed rewards", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        rewards: [
          {
            id: "42",
            currencyType: "soft",
            amount: "150",
            reason: "subscription_daily",
            note: "Daily Gold subscription reward (5 days)",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.rewards).toHaveLength(1);
    }
  });

  it("keeps a held reward's hold", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        rewards: [
          {
            id: "7",
            currencyType: "hard",
            amount: "50",
            reason: "level_milestone",
            note: null,
            held: "trust",
          },
          {
            id: "8",
            currencyType: "soft",
            amount: "150",
            reason: "level_up",
            note: null,
          },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.rewards?.map((r) => r.held)).toEqual([
        "trust",
        undefined,
      ]);
    }
  });

  it("accepts a response without rewards (older API versions)", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player: basePlayer }).success,
    ).toBe(true);
  });
});

describe("UserMeResponseSchema unlimitedRanked", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a player exempt from ranked play limits", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: { ...basePlayer, unlimitedRanked: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.unlimitedRanked).toBe(true);
    }
  });

  it("accepts a response without unlimitedRanked", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player: basePlayer }).success,
    ).toBe(true);
  });
});

describe("UserMeResponseSchema Steam licence and notices", () => {
  const player = {
    publicId: "p1",
    adfree: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("defaults the fields an older API does not send", () => {
    const result = UserMeResponseSchema.safeParse({ user: {}, player });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steamLicence).toBe(false);
      expect(result.data.steamLicenceSince).toBeNull();
      expect(result.data.noticesSeen).toEqual([]);
      expect(result.data.tierConversion).toBeUndefined();
    }
  });

  it("accepts a licence holder with a conversion and seen notices", () => {
    const tierConversion = {
      id: "17",
      fromTierName: "warlord",
      toTierName: "steam_plus",
      convertedAt: "2026-10-01T12:00:00.000Z",
    };
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: { ...player, canCreatePublicLobbies: true },
      steamLicence: true,
      steamLicenceSince: "2026-10-14T09:30:00.000Z",
      noticesSeen: ["steam_licence_intro"],
      tierConversion,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steamLicence).toBe(true);
      expect(result.data.steamLicenceSince).toBe("2026-10-14T09:30:00.000Z");
      expect(result.data.noticesSeen).toEqual(["steam_licence_intro"]);
      expect(result.data.tierConversion).toEqual(tierConversion);
    }
  });

  it("accepts a null tierConversion", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player, tierConversion: null })
        .success,
    ).toBe(true);
  });
});

describe("UserMeResponseSchema canCreatePublicLobbies", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    unlimitedRanked: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a player allowed to list lobbies publicly", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: { ...basePlayer, canCreatePublicLobbies: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.canCreatePublicLobbies).toBe(true);
    }
  });

  it("rejects a response without canCreatePublicLobbies", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player: basePlayer }).success,
    ).toBe(false);
  });
});

describe("UserMeResponseSchema account username", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a lapsed claim holder (suffix showing, grace deadline set)", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        username: "Bob.4821",
        usernameBase: "Bob",
        usernameDiscriminator: "4821",
        usernameStatus: "claimed",
        usernameClaimExpiresAt: "2026-08-17T19:42:00.000Z",
        nextUsernameChangeAt: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.username).toBe("Bob.4821");
      expect(result.data.player.usernameStatus).toBe("claimed");
    }
  });

  it("accepts a response without any username fields (older API)", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: basePlayer,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.usernameStatus).toBeUndefined();
    }
  });

  it("accepts a player who never set a name (all null, unclaimed)", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        username: null,
        usernameBase: null,
        usernameDiscriminator: null,
        usernameStatus: "unclaimed",
        usernameClaimExpiresAt: null,
        nextUsernameChangeAt: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("keeps a leading-zero discriminator as a string", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        username: "Ann.0042",
        usernameBase: "Ann",
        usernameDiscriminator: "0042",
        usernameStatus: "unclaimed",
        usernameClaimExpiresAt: null,
        nextUsernameChangeAt: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.usernameDiscriminator).toBe("0042");
    }
  });

  it("rejects an unknown usernameStatus", () => {
    expect(
      UserMeResponseSchema.safeParse({
        user: {},
        player: { ...basePlayer, usernameStatus: "expired" },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO usernameClaimExpiresAt", () => {
    expect(
      UserMeResponseSchema.safeParse({
        user: {},
        player: {
          ...basePlayer,
          usernameStatus: "claimed",
          usernameClaimExpiresAt: "next month",
        },
      }).success,
    ).toBe(false);
  });
});

describe("UserMeResponseSchema creator", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a player with no creator binding", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: { ...basePlayer, creator: null },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.creator).toBeNull();
    }
  });

  it("accepts a player bound to a creator, cooldown running", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        creator: {
          code: "LEWIS",
          displayName: "Lewis",
          sinceAt: "2026-08-01T00:00:00.000Z",
          canChangeAt: "2026-08-08T00:00:00.000Z",
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.creator).toEqual({
        code: "LEWIS",
        displayName: "Lewis",
        sinceAt: "2026-08-01T00:00:00.000Z",
        canChangeAt: "2026-08-08T00:00:00.000Z",
      });
    }
  });

  it("accepts a player bound to a creator, cooldown elapsed (canChangeAt null)", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        creator: {
          code: "LEWIS",
          displayName: "Lewis",
          sinceAt: "2026-08-01T00:00:00.000Z",
          canChangeAt: null,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.creator?.canChangeAt).toBeNull();
    }
  });

  // This client ships before an API without the field, and after one that
  // predates it — both must parse so old and new deployments coexist.
  it("accepts a response without the field at all (older API)", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player: basePlayer }).success,
    ).toBe(true);
  });
});

describe("isTemporaryUsername", () => {
  it.each(["TEMPORARY0042", "TEMPORARY9999"])("detects %s", (name) => {
    expect(isTemporaryUsername(name)).toBe(true);
  });

  it.each([
    "temporary1234",
    "TEMPORARY123",
    "TEMPORARY12345",
    "TEMPORARYabcd",
    "Bob",
  ])("rejects %s", (name) => {
    expect(isTemporaryUsername(name)).toBe(false);
  });

  it("handles null and undefined bases", () => {
    expect(isTemporaryUsername(null)).toBe(false);
    expect(isTemporaryUsername(undefined)).toBe(false);
  });
});

describe("UserMeResponseSchema player achievements", () => {
  const achievements = UserMeResponseSchema.shape.player.shape.achievements;

  it("keeps the server-awarded player achievements array", () => {
    const parsed = achievements.parse({
      singleplayerMap: [],
      player: [{ achievement: "win_ffa", game: "abc123", achievedAt: null }],
    });
    expect(parsed.player[0].achievement).toBe("win_ffa");
  });

  it("defaults player to an empty array when the server omits it", () => {
    const parsed = achievements.parse({ singleplayerMap: [] });
    expect(parsed.player).toEqual([]);
  });
});
