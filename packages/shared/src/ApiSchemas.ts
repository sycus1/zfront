import {
  Difficulty,
  GameMode,
  GameType,
  HumansVsNations,
} from "@openfront/engine-api/game/GameTypes";
import { ClanTagSchema } from "@openfront/engine-api/Schemas";
import {
  BigIntStringSchema,
  PlayerStatsSchema,
} from "@openfront/engine-api/StatsSchemas";
import { z } from "zod";
import { base64urlToUuid } from "./Base64";
import {
  LEVEL_BADGE_MAX_LEVEL,
  LEVEL_BADGE_MAX_PRESTIGE,
} from "./LevelBadgeWire";

const RequiredClanTagSchema = ClanTagSchema.unwrap();

export const TokenPayloadSchema = z.object({
  jti: z.string(),
  sub: z
    .string()
    .refine(
      (val) => {
        const uuid = base64urlToUuid(val);
        return !!uuid;
      },
      {
        message: "Invalid base64-encoded UUID",
      },
    )
    .transform((val) => {
      const uuid = base64urlToUuid(val);
      if (!uuid) throw new Error("Invalid base64 UUID");
      return uuid;
    }),
  iat: z.number(),
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  role: z
    .enum(["root", "admin", "mod", "flagged", "banned"])
    // In case new roles are added in the future.
    .or(z.string())
    .optional(),
  provider: z.string().optional(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "root";
}

export const DiscordUserSchema = z.object({
  id: z.string(),
  avatar: z.string().nullable(),
  username: z.string(),
  global_name: z.string().nullable(),
  discriminator: z.string(),
});

export const GoogleUserSchema = z.object({
  email: z.string(),
});

export const SteamUserSchema = z.object({
  steamId: z.string(),
  personaName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

const SingleplayerMapAchievementSchema = z.object({
  mapName: z.string(),
  difficulty: z.enum(Difficulty),
});

// One row from player_achievements. Feats recur -- one row per qualifying
// game -- so the same `achievement` appears many times for a veteran player.
// Consumers that care about "has this been earned" must deduplicate by name.
export const PlayerAchievementSchema = z.object({
  achievement: z.string(),
  // games.game -- the client-generated game id (an instance letter plus a
  // nine-character nanoid, stored as a varchar). NOT the server's `gameId`,
  // which is a stringified bigint row id.
  game: z.string().nullable(),
  achievedAt: z.iso.datetime().nullable(),
});

// An unclaimed subscription reward from GET /users/@me. `id` and `amount` are
// stringified bigints — keep them as strings (amount can in principle exceed
// Number.MAX_SAFE_INTEGER). `reason` is open-ended server-side; fall back to
// `note` for unknown values rather than exhausting on an enum.
export const RewardSchema = z.object({
  id: z.string(),
  currencyType: z.enum(["soft", "hard"]),
  amount: z.string(),
  reason: z.string(),
  note: z.string().nullable(),
  // On a level reward (`level_up` / `level_milestone`): the level it was
  // paid for, and the prestige run it was reached in. Absent on every other
  // reward, and on an API that predates them.
  level: z.number().optional(),
  prestige: z.number().optional(),
  // Why the reward can't be claimed yet; absent when it can. "trust": level
  // Plutonium, kept until the account is trusted. Any other non-empty value is
  // a hold this client doesn't know yet, and still reads as held: an unknown
  // restriction must never read as claimable, so a malformed value (a number,
  // an object, "") reads as held too. Absent or null: claimable, as from
  // older APIs.
  held: z
    .unknown()
    .transform((v): string | undefined =>
      v === undefined || v === null
        ? undefined
        : typeof v === "string" && v.length > 0
          ? v
          : "unknown",
    )
    .optional(),
});

// Player levels / XP ("progression"). Purely cosmetic: levels never affect
// gameplay, and XP is computed server-side only — the client just displays it.
// Level 1..100, prestige 0..10; `legend` is level 100 at the last prestige.
export const ProgressSchema = z.object({
  prestige: z.number(),
  level: z.number(),
  // XP into the current level; 0 at level 100.
  xpInLevel: z.number(),
  // XP needed for the next level; 0 at level 100.
  xpForNext: z.number(),
  lifetimeXp: z.number(),
  legend: z.boolean(),
  canPrestige: z.boolean(),
  // /users/@me only, for the provisional XP figure shown at death
  // (src/client/ProvisionalXp.ts). What the player has used today (UTC) of
  // the per-day XP allowances. Optional, and a malformed block reads as
  // absent: it must never fail the progress object around it.
  daily: z
    .object({
      // The UTC day ("YYYY-MM-DD", the server's clock) the counts are for.
      // A game ending on a later day starts from none used.
      day: z.string().optional().catch(undefined),
      privateGames: z.number(),
      singleplayerGames: z.number(),
      firstGameClaimed: z.boolean(),
    })
    .optional()
    .catch(undefined),
  // The player's subscription XP multiplier; 1000 = none.
  subscriberPermille: z.number().optional().catch(undefined),
});
export type Progress = z.infer<typeof ProgressSchema>;

// The rules a game's XP is scored under (XpRules in the API's
// ProgressionConfig.ts): integers, with multipliers in permille.
export const XpRulesSchema = z.object({
  minAliveTicks: z.number().int(),
  gameXp: z.number().int(),
  xpPerMinute: z.number().int(),
  timeCapMinutes: z.number().int(),
  ffaPlacementMax: z.number().int(),
  ffaWin: z.number().int(),
  fullLobbyHumans: z.number().int(),
  teamWin: z.number().int(),
  teamWinMinAlivePermille: z.number().int(),
  hvnWin: z.number().int(),
  firstGameOfDay: z.number().int(),
  featXp: z.number().int(),
  maxFeatsPerGame: z.number().int(),
  publicPermille: z.number().int(),
  rankedPermille: z.number().int(),
  privatePermille: z.number().int(),
  singleplayerPermille: z.number().int(),
  privateMinHumans: z.number().int(),
  privateGamesPerDay: z.number().int(),
  singleplayerGamesPerDay: z.number().int(),
});
export type XpRules = z.infer<typeof XpRulesSchema>;

// A player's level as stamped onto rows in other players' lists (the ranked
// leaderboard, clan member lists), for drawing a level badge. Sent together
// for a player with progress; absent for one without, while progression is
// off, and from an API that predates them. Display-only, so a malformed or
// out-of-range value reads as absent (that row shows no badge) rather than
// failing the whole list's parse or drawing a level the player doesn't have.
export const RowLevelFields = {
  level: z
    .number()
    .int()
    .min(1)
    .max(LEVEL_BADGE_MAX_LEVEL)
    .optional()
    .catch(undefined),
  prestige: z
    .number()
    .int()
    .min(0)
    .max(LEVEL_BADGE_MAX_PRESTIGE)
    .optional()
    .catch(undefined),
  legend: z.boolean().optional().catch(undefined),
};

// A flare staff put on the level track: what reaching a point on it grants.
// `kind` says what the point is:
//   level    — reaching `level` in run `prestige` (0 = the first run), or in
//              any run when `prestige` is null;
//   prestige — prestiging into rank `prestige`; `level` is null;
//   legend   — becoming a Legend; both null.
// `cosmetic` is the cosmetic the flare unlocks, when it is one (its flare
// name is "<type>:<name>", the way the cosmetics catalog names it).
export const TrackFlareSchema = z.object({
  kind: z.string(),
  level: z.number().nullable(),
  prestige: z.number().nullable(),
  flareName: z.string(),
  cosmetic: z
    .object({
      type: z.string(),
      name: z.string(),
      url: z.string().nullable().optional(),
    })
    .nullable()
    .optional()
    .catch(null),
});
export type TrackFlare = z.infer<typeof TrackFlareSchema>;

// GET /public/progression/config — the level curve, and the rewards along it.
// No auth, cacheable. Everything past the curve came later, so it is optional
// and tolerant: an older API (or one malformed entry) still parses, and the
// confirmation falls back to what it showed before.
export const ProgressionConfigSchema = z.object({
  version: z.number(),
  maxLevel: z.number(),
  maxPrestige: z.number(),
  levels: z.array(
    z.object({
      level: z.number(),
      xpToNext: z.number(),
      cumulativeXp: z.number(),
      // Paid on reaching this level, every prestige run.
      caps: z.number().optional().catch(undefined),
      plutonium: z.number().optional().catch(undefined),
    }),
  ),
  // The revision of the API's XP formula (computeXp). The client carries a
  // copy of one revision, for the provisional figure shown at death, and
  // shows none when this is absent or names another revision.
  formula: z.number().optional().catch(undefined),
  // Whether the API scores only multiplayer games whose end-of-game vote
  // agreed on the stats (true in production).
  requireStatsAgreed: z.boolean().optional().catch(undefined),
  // Whether the API scores singleplayer games, which never carry that vote
  // (at the singleplayer rate and daily cap). The API always sends true; a
  // malformed value reads as absent, and the client takes that as no.
  scoresSingleplayer: z.boolean().optional().catch(undefined),
  // The rules that formula runs on. Absent from older APIs; a malformed block
  // only loses the provisional figure, never the level curve.
  xp: XpRulesSchema.optional().catch(undefined),
  // The rules behind each level's amounts.
  levelRewards: z
    .object({
      capsBands: z.array(
        z.object({
          fromLevel: z.number(),
          toLevel: z.number(),
          caps: z.number(),
        }),
      ),
      plutonium: z.object({
        fromLevel: z.number(),
        everyLevels: z.number(),
        amount: z.number(),
      }),
    })
    .optional()
    .catch(undefined),
  // The Caps every prestige grants.
  prestige: z.object({ caps: z.number() }).optional().catch(undefined),
  // In track order. An entry that doesn't parse is dropped, not the list.
  flares: z
    .array(TrackFlareSchema.nullable().catch(null))
    .optional()
    .catch(undefined)
    .transform((flares) =>
      (flares ?? []).filter((f): f is TrackFlare => f !== null),
    ),
});
export type ProgressionConfig = z.infer<typeof ProgressionConfigSchema>;

const CurrencyBalancesSchema = z.object({
  soft: z.coerce.number(),
  hard: z.coerce.number(),
});

// Account-username lifecycle. `unclaimed`: no bare-name reservation (default).
// `claimed`: reservation held but subscription lapsed — the suffix shows again
// and a grace deadline runs. `premium`: subscribed, bare display. `indefinite`:
// admin-locked bare display. Statuses change server-side without client action
// (Stripe webhooks, admin edits) — re-fetch /users/@me rather than caching.
export const UsernameStatusSchema = z.enum([
  "unclaimed",
  "claimed",
  "premium",
  "indefinite",
]);

// When a player subscribes while someone else exclusively holds their bare
// name, the server renames them to TEMPORARY#### and clears their cooldown so
// the rename is free. Detect it to prompt for a real name.
export function isTemporaryUsername(base: string | null | undefined): boolean {
  return typeof base === "string" && /^TEMPORARY\d{4}$/.test(base);
}

export const UserMeResponseSchema = z.object({
  user: z.object({
    discord: DiscordUserSchema.optional(),
    google: GoogleUserSchema.optional(),
    email: z.string().optional(),
    steam: SteamUserSchema.optional(),
  }),
  // The caller's active account ban, shown to them (localized client-side), or
  // null. `category` is a server enum but kept as a string here so an
  // unrecognised value degrades gracefully. Optional so an older API that
  // predates the field is treated as "no ban".
  ban: z
    .object({
      category: z.string(),
      reason: z.string().nullable(),
      expiresAt: z.iso.datetime().nullable(),
    })
    .nullable()
    .optional(),
  // Owns OpenFront on Steam. A licence is not a subscription: it confers
  // custom lobbies and the verified name with `subscription` null, so a
  // licence holder with no subscription has not lapsed.
  steamLicence: z.boolean().optional().default(false),
  // ISO date the player's Steam account first owned the base game, or null
  // when unknown.
  steamLicenceSince: z.string().nullable().optional().default(null),
  // Notice keys this player has dismissed (POST /users/@me/notices).
  noticesSeen: z.array(z.string()).optional().default([]),
  // Server-raised messages due for this player and not yet shown
  // (POST /users/@me/messages/seen once shown), e.g. "report_thanks".
  pendingMessages: z.array(z.string()).optional().default([]),
  // The player's most recent automatic tier conversion, if any.
  tierConversion: z
    .object({
      id: z.string(),
      fromTierName: z.string(),
      toTierName: z.string(),
      convertedAt: z.string(),
    })
    .nullable()
    .optional(),
  player: z.object({
    publicId: z.string(),
    adfree: z.boolean(),
    // Ranked play limits are gone; the API still sends this and a later
    // release drops it. Nothing reads it.
    unlimitedRanked: z.boolean().optional(),
    // True when the player may list a custom lobby publicly. The API decides
    // which subscriptions, grants and Steam licences confer this.
    canCreatePublicLobbies: z.boolean(),
    // Account trust as computed by the API. "untrusted" means new, unlinked or
    // banned, never an accusation. null when the API's computation failed;
    // absent on an API that predates the field. Both read as untrusted.
    trustTier: z.enum(["untrusted", "trusted"]).nullable().optional(),
    // Account username (custom-usernames). All optional so responses from an
    // API without the feature still parse; absent means the same as never set.
    // `username` is the server-resolved DISPLAY form — the bare base for an
    // entitled claim holder, otherwise "base.suffix". Render it as-is; never
    // assemble base + discriminator client-side. The discriminator is exactly
    // 4 digits and may have leading zeros — keep it a string.
    username: z.string().nullable().optional(),
    usernameBase: z.string().nullable().optional(),
    usernameDiscriminator: z.string().nullable().optional(),
    usernameStatus: UsernameStatusSchema.optional(),
    // Only non-null in `claimed`: when the exclusive right to the bare name
    // becomes takeable by another subscriber. A past date means "at risk",
    // not "lost" — it stays set until the name is actually taken.
    usernameClaimExpiresAt: z.iso.datetime().nullable().optional(),
    // When the player may next self-rename. May be in the past — past or
    // null both mean a rename is allowed.
    nextUsernameChangeAt: z.iso.datetime().nullable().optional(),
    flares: z.string().array().optional(),
    achievements: z.object({
      singleplayerMap: z.array(SingleplayerMapAchievementSchema),
      // Optional with a default rather than required: prod and staging deploy
      // on separate schedules, and a client that hard-failed against a server
      // without this field would take out the whole account panel.
      player: z.array(PlayerAchievementSchema).optional().default([]),
    }),
    leaderboard: z
      .object({
        oneVone: z
          .object({
            elo: z.number().optional(),
          })
          .optional(),
        twoVtwo: z
          .object({
            elo: z.number().optional(),
          })
          .optional(),
        ffa: z
          .object({
            elo: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    currency: CurrencyBalancesSchema.optional(),
    // Unclaimed rewards — NOT included in `currency` balances until claimed.
    rewards: RewardSchema.array().optional(),
    // Level / XP. Absent when progression is off (or on an API that predates
    // it): every level UI hides itself then. Optional rather than defaulted,
    // so "absent" never renders as "level 1, 0 XP". A malformed object also
    // reads as absent: drift in this cosmetic field must never fail the whole
    // /users/@me parse, which would make the player look signed out.
    progress: ProgressSchema.optional().catch(undefined),
    // "Hide my level": true when the player opted out of showing their level
    // to others. They still earn XP and see their own level; the game server
    // then leaves the badge off their lobby roster entry. Optional so an older
    // API without the setting still parses — absent reads as shown, and the
    // account settings hide the Privacy card. A malformed value reads as
    // hidden: the server parses this response at join, so a bad value must
    // never fail the parse and reject the join, and when the setting can't be
    // read the private answer is the safe one.
    levelHidden: z.boolean().optional().catch(true),
    // "Show my profile in search engines" turned off: the public profile page
    // (openfront.io/player/<publicId>) is served noindex. It still opens for
    // anyone with the link, and link previews are unchanged. Optional so an
    // older API without the setting still parses — absent hides the row in
    // account settings. A malformed value reads as hidden, like levelHidden.
    searchHidden: z.boolean().optional().catch(true),
    clans: z
      .array(
        z.object({
          tag: RequiredClanTagSchema,
          name: z.string(),
          role: z.enum(["leader", "officer", "member"]),
          joinedAt: z.iso.datetime(),
          memberCount: z.number().int().min(1),
          // Clan currency — see ClanInfoSchema in ClanApiSchemas.ts for the
          // format. Decimal bigint strings; optional for older responses.
          softBalance: z.string().optional(),
          hardBalance: z.string().optional(),
        }),
      )
      .optional(),
    clanRequests: z
      .array(
        z.object({
          tag: RequiredClanTagSchema,
          name: z.string(),
          createdAt: z.iso.datetime(),
        }),
      )
      .optional(),
    friends: z.array(z.string()),
    subscription: z
      .object({
        tier: z.string(),
        status: z.string(),
        currentPeriodEnd: z.coerce.date().nullable(),
        cancelAtPeriodEnd: z.boolean(),
        // Which rail is billing this subscription, and `null` means NOBODY IS:
        // it is a grant (a free month from a Steam purchase, or an admin comp).
        // The server branches on the same distinction — cancelling a grant has
        // no period to run out, so it expires the subscription immediately and
        // takes the premium username with it.
        //
        // Three states, and the client must keep all three apart:
        //   "stripe" / "steam" — paid, someone is being billed.
        //   null               — granted.
        //   undefined          — the server predates the field (it reaches
        //                        staging at the next deploy), so we do not
        //                        know. Callers must fall back to the PAID
        //                        behaviour here: on an old server a grant is
        //                        indistinguishable from a Stripe subscription,
        //                        and treating everyone as granted would hide
        //                        Cancel from paying subscribers.
        // Test `=== null` and `=== undefined`, never `!provider` — that is true
        // for both and collapses the two states that must not collapse.
        //
        // Loose `z.string()` rather than z.enum(["stripe", "steam"]), matching
        // `status` above: a parse failure here fails the WHOLE /users/@me
        // response (Api.ts logs and returns false, and the account view goes
        // blank), so a future third rail must not be able to brick an older
        // client. An unrecognised value is simply not `null`, which lands on
        // the paid behaviour — the safe side.
        provider: z.string().nullable().optional(),
        // Who gave a GRANTED subscription: "steam", "admin" or
        // "discord_role", and null on a paid one. Absent on a server that
        // predates the field; see `isSteamGrant` for what that falls back to.
        // Loose `z.string()` for the same reason as `provider`.
        grantSource: z.string().nullable().optional(),
      })
      .nullable(),
    // A Stripe subscription whose renewal failed and is still being retried,
    // sent only when `subscription` is null. It entitles nothing, which is
    // why it is not `subscription`: every caller reads that as "subscribed".
    // It exists so the account can say the payment failed and offer the
    // billing portal. Optional so an older API without the field still parses.
    pastDueSubscription: z.object({ tier: z.string() }).nullable().optional(),
    // Marketing-email consent state (client-driven consent). `consented` is the
    // player's current decision; `hasEmail` is whether a verified contact email
    // exists to subscribe. Optional so an older API without the field is treated
    // as "no consent UI".
    marketingConsent: z
      .object({
        consented: z.enum(["approved", "denied", "no_response"]),
        hasEmail: z.boolean(),
      })
      .optional(),
    // The caller's ACTIVE creator-support binding (Creator Code programme), or
    // null if unbound. Shown regardless of the creator's current status —
    // suspending a creator doesn't un-bind their existing supporters, only
    // blocks *new* bindings (enforced server-side at PUT /users/@me/creator).
    // `sinceAt` is when the binding started; `canChangeAt` is null once the
    // 7-day change cooldown has elapsed, so the client can tell "still bound,
    // cooldown over" from "still bound, cooldown running" without hardcoding
    // the cooldown length itself. `creator: null` does NOT by itself mean a
    // new bind is unthrottled — a cooldown can still be running from a recent
    // unbind; only PUT's own 429 reveals that.
    // .optional() exists ONLY so an older API without the field is tolerated
    // (the UI renders nothing then).
    creator: z
      .object({
        code: z.string(),
        displayName: z.string(),
        sinceAt: z.iso.datetime(),
        canChangeAt: z.iso.datetime().nullable(),
      })
      .nullable()
      .optional(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;
export type UserSubscription = NonNullable<
  NonNullable<UserMeResponse["player"]["subscription"]>
>;

/**
 * Is this subscription a GRANT — free access nobody is billing — rather than
 * something the player bought?
 *
 * The one definition, shared by every surface that has to tell the two apart
 * (OPE-314 hid the account panel's destructive controls on it; OPE-440 turned
 * the store's dead "Subscribed" tile back into a buy action). It applies the
 * exact three-state rule documented on `provider` above, so a caller cannot
 * re-derive a fourth:
 *
 *   null      — granted.
 *   "stripe" / "steam" (or any future rail) — paid.
 *   undefined — the server predates the field, so we CANNOT tell. Falls back
 *               to the PAID behaviour, which is the safe side on every
 *               caller: it keeps Cancel in front of a paying subscriber, and
 *               it never sends one to a second checkout.
 *
 * Spelled out rather than `!sub.provider`, which is true for `undefined` too
 * and so collapses the two states that must not collapse.
 *
 * The explicit null/undefined guard is for the THIRD case — no subscription at
 * all. `sub?.provider === null` would in fact answer this predicate correctly
 * (`undefined === null` is false), but it answers by accident: it returns the
 * same `false` for "pays us" and "has nothing", and those have separate
 * branches in every caller. The guard names the case instead of relying on two
 * unrelated states landing on one value.
 */
export function isGrantedSubscription(
  sub: UserSubscription | null | undefined,
): boolean {
  if (sub === null || sub === undefined) return false;
  return sub.provider === null;
}

/**
 * Is a Steam month currently funding this grant?
 *
 * Not the same as "the subscription was bought on Steam". The server answers
 * "steam" for a row Steam created AND for an admin comp or Discord-role grant
 * that a Steam month is extending in place; once that month is spent the row
 * goes back to its own grantor and stays entitled. So this says where the
 * current period came from, and nothing about what happens when it ends.
 *
 * The one definition, shared by the account panel and the Steam grant notices,
 * both of which tell the player their current access came with a purchase. An
 * admin can give a grant an end date too, so the date alone does not say that.
 *
 *   "steam"   — yes.
 *   any other value — no: an admin comp or a Discord-role grant.
 *   undefined — the server predates the field, and the old rule still holds
 *               there: a dated grant is a Steam month. Such a server cannot
 *               write a dated admin grant (both arrived in one deploy). Nor
 *               a dated Discord-role grant without Steam: the role sync
 *               inserts those open-ended, and only a Steam month extending
 *               one gives it a date — which the current server reports as
 *               "steam" too, so the fallback and the field agree.
 */
export function isSteamGrant(
  sub: UserSubscription | null | undefined,
): boolean {
  if (!isGrantedSubscription(sub) || !sub?.currentPeriodEnd) return false;
  return sub.grantSource === "steam" || sub.grantSource === undefined;
}

export const PlayerRecentStatsSchema = z.object({
  games: z.number().int().min(0).max(100),
  wins: z.number().int().min(0).max(100),
});

export const PlayerStatsLeafSchema = z.object({
  wins: BigIntStringSchema,
  losses: BigIntStringSchema,
  total: BigIntStringSchema,
  stats: PlayerStatsSchema,
  recent: PlayerRecentStatsSchema.optional(),
  // Temporary client-first rollout compatibility. The replacement infra
  // response exposes only aggregate counts under stats.recent.
  recentGames: z
    .array(
      z.object({
        gameId: BigIntStringSchema,
        won: z.boolean(),
      }),
    )
    .optional(),
});

export const PlayerStatsGameModes = [
  GameMode.FFA,
  GameMode.Team,
  HumansVsNations,
] as const;

const RecentByDifficultySchema = z.object({
  all: PlayerRecentStatsSchema,
  [Difficulty.Easy]: PlayerRecentStatsSchema.optional(),
  [Difficulty.Medium]: PlayerRecentStatsSchema.optional(),
  [Difficulty.Hard]: PlayerRecentStatsSchema.optional(),
  [Difficulty.Impossible]: PlayerRecentStatsSchema.optional(),
});

const RecentGameTypeStatsSchema = RecentByDifficultySchema.extend({
  [GameMode.FFA]: RecentByDifficultySchema.optional(),
  [GameMode.Team]: RecentByDifficultySchema.optional(),
  [HumansVsNations]: RecentByDifficultySchema.optional(),
});

export const PlayerRecentStatsTreeSchema = z.object({
  all: PlayerRecentStatsSchema,
  [GameType.Singleplayer]: RecentGameTypeStatsSchema.optional(),
  [GameType.Public]: RecentGameTypeStatsSchema.optional(),
  [GameType.Private]: RecentGameTypeStatsSchema.optional(),
});

const GameModeStatsSchema = z.partialRecord(
  z.enum(PlayerStatsGameModes),
  z.partialRecord(z.enum(Difficulty), PlayerStatsLeafSchema),
);

export const PlayerStatsTreeSchema = z.object({
  Singleplayer: GameModeStatsSchema.optional(),
  Public: GameModeStatsSchema.optional(),
  Private: GameModeStatsSchema.optional(),
  recent: PlayerRecentStatsTreeSchema.optional(),
});

export const PlayerProfileSchema = z.object({
  createdAt: z.iso.datetime(),
  user: DiscordUserSchema.optional(),
  // Account username, pre-rendered by the server (bare base or "base.suffix").
  // null = the player never set one. Render `username ?? publicId`; never
  // parse it — compare players by publicId only. Optional so responses from
  // an API without the field still parse.
  username: z.string().nullable().optional(),
  stats: PlayerStatsTreeSchema,
  // Clans this player belongs to, tag-ordered. Optional so responses from an
  // API without the field still parse (→ no clans shown).
  clans: z
    .array(
      z.object({
        tag: RequiredClanTagSchema,
        name: z.string(),
        role: z.enum(["leader", "officer", "member"]),
        joinedAt: z.iso.datetime(),
        memberCount: z.number().int().min(1),
        // Clan currency — see ClanInfoSchema in ClanApiSchemas.ts for the
        // format. Decimal bigint strings; optional for older responses.
        softBalance: z.string().optional(),
        hardBalance: z.string().optional(),
      }),
    )
    .optional(),
  // The tag to show beside the player's name: the one from their latest game
  // played under a clan they still belong to. null when none of their recent
  // games has one. Optional so responses from an API without the field still
  // parse (→ no tag shown).
  displayClanTag: z.string().nullable().optional(),
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;
