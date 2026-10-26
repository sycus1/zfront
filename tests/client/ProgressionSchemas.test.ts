import {
  ProgressionConfigSchema,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { describe, expect, it } from "vitest";

const progress = {
  prestige: 2,
  level: 37,
  xpInLevel: 120,
  xpForNext: 900,
  lifetimeXp: 123456,
  legend: false,
  canPrestige: false,
};

function userMe(player: Record<string, unknown> = {}) {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "abc",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      ...player,
    },
  };
}

describe("UserMeResponseSchema progress", () => {
  it("parses a response from an API that predates progression", () => {
    const parsed = UserMeResponseSchema.safeParse(userMe());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.player.progress).toBeUndefined();
  });

  it("parses progress when present", () => {
    const parsed = UserMeResponseSchema.parse(userMe({ progress }));
    expect(parsed.player.progress).toEqual(progress);
  });

  it("drops a malformed progress object but still parses the profile", () => {
    const parsed = UserMeResponseSchema.safeParse(
      userMe({ progress: { level: "ten" } }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data?.player.progress).toBeUndefined();
    expect(parsed.data?.player.publicId).toBe("abc");
  });

  it("drops a non-object progress value but still parses the profile", () => {
    const parsed = UserMeResponseSchema.safeParse(userMe({ progress: "x" }));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.player.progress).toBeUndefined();
  });
});

describe("provisional XP fields", () => {
  const config = {
    version: 2,
    maxLevel: 100,
    maxPrestige: 10,
    levels: [{ level: 1, xpToNext: 100, cumulativeXp: 0 }],
  };
  const rules = {
    minAliveTicks: 1200,
    gameXp: 50,
    xpPerMinute: 17,
    timeCapMinutes: 30,
    ffaPlacementMax: 150,
    ffaWin: 300,
    fullLobbyHumans: 20,
    teamWin: 150,
    teamWinMinAlivePermille: 500,
    hvnWin: 100,
    firstGameOfDay: 100,
    featXp: 0,
    maxFeatsPerGame: 3,
    publicPermille: 1000,
    rankedPermille: 1250,
    privatePermille: 500,
    singleplayerPermille: 250,
    privateMinHumans: 4,
    privateGamesPerDay: 10,
    singleplayerGamesPerDay: 5,
  };

  it("parses the formula revision, its rules and the prestige rewards", () => {
    const data = { ...config, formula: 1, xp: rules, prestige: { caps: 0 } };
    expect(ProgressionConfigSchema.parse(data)).toEqual({
      ...data,
      flares: [],
    });
  });

  it("keeps the level curve when the rules are malformed", () => {
    const parsed = ProgressionConfigSchema.parse({
      ...config,
      formula: 1,
      xp: { ...rules, gameXp: "fifty" },
    });
    expect(parsed.xp).toBeUndefined();
    expect(parsed.levels).toEqual(config.levels);
  });

  it("reads first-win rules (from before the first game of the day) as absent", () => {
    const firstWinRules: Record<string, number> = {
      ...rules,
      firstWinOfDay: 200,
    };
    delete firstWinRules.firstGameOfDay;
    const parsed = ProgressionConfigSchema.parse({
      ...config,
      formula: 1,
      xp: firstWinRules,
    });
    expect(parsed.xp).toBeUndefined();
    expect(parsed.levels).toEqual(config.levels);
  });

  it("parses today's allowances and the subscriber boost on progress", () => {
    const daily = {
      privateGames: 2,
      singleplayerGames: 0,
      firstGameClaimed: true,
    };
    const parsed = UserMeResponseSchema.parse(
      userMe({ progress: { ...progress, daily, subscriberPermille: 1200 } }),
    );
    expect(parsed.player.progress?.daily).toEqual(daily);
    expect(parsed.player.progress?.subscriberPermille).toBe(1200);
  });

  it("drops a first-win allowance block but keeps the progress", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({
        progress: {
          ...progress,
          daily: {
            privateGames: 0,
            singleplayerGames: 0,
            firstWinClaimed: true,
          },
        },
      }),
    );
    expect(parsed.player.progress?.level).toBe(37);
    expect(parsed.player.progress?.daily).toBeUndefined();
  });

  it("drops a malformed allowance block but keeps the progress", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({ progress: { ...progress, daily: { privateGames: "x" } } }),
    );
    expect(parsed.player.progress?.level).toBe(37);
    expect(parsed.player.progress?.daily).toBeUndefined();
  });
});
