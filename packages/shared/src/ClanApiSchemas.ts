import { ClanTagSchema } from "@openfront/engine-api/Schemas";
import { z } from "zod";

const RequiredClanTagSchema = ClanTagSchema.unwrap();

// Response for the game-server endpoint listing every registered clan tag.
export const ReservedClanTagsResponseSchema = z.array(z.string());

export const ClanInfoSchema = z.object({
  name: z.string().max(35),
  tag: RequiredClanTagSchema,
  description: z.string().max(200),
  // Discord invite URL set by the clan leader; null when unset. Optional
  // because not every ClanInfo source includes it (e.g. browse results).
  discordUrl: z.string().max(255).nullable().optional(),
  isOpen: z.boolean(),
  createdAt: z.iso.datetime().optional(),
  memberCount: z.number().optional(),
  // Clan currency, public info (no membership gate). Decimal bigint strings
  // ("0" when empty, never a number) — they are int64 server-side and can
  // exceed Number.MAX_SAFE_INTEGER, so compare and sum with BigInt, never
  // Number. Optional because not every ClanInfo source carries them (the PATCH
  // response, an API deploy predating the field) — absent means "unknown",
  // which the UI hides rather than rendering as zero.
  softBalance: z.string().optional(),
  hardBalance: z.string().optional(),
  // A clan boost is running (browse results only).
  boosted: z.boolean().optional(),
  // When the clan's boost runs out; null when unboosted (clan detail only).
  boostEndsAt: z.iso.datetime().nullable().optional(),
});
export type ClanInfo = z.infer<typeof ClanInfoSchema>;
