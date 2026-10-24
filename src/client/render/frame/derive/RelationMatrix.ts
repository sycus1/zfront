import type { PlayerStatic } from "../../types";

const RELATION_SIZE = 1024;
const RELATION_NEUTRAL = 0;
const RELATION_FRIENDLY = 1;

/** Reusable matrix buffer — one allocation, rewritten each frame. */
const matrix = new Uint8Array(RELATION_SIZE * RELATION_SIZE);

export interface RelationMatrixResult {
  matrix: Uint8Array;
  size: number;
}

/**
 * Build a relationship matrix from team data.
 * Indexed by `[ownerA * size + ownerB]` → 0=neutral, 1=friendly.
 *
 * @param teams  Optional smallID→team map. Same-team players are marked friendly.
 */
export function buildRelationMatrix(
  teams?: ReadonlyMap<number, string>,
): RelationMatrixResult {
  matrix.fill(RELATION_NEUTRAL);

  // Teammates — mark same-team pairs as friendly
  if (teams && teams.size > 0) {
    const byTeam = new Map<string, number[]>();
    for (const [sid, team] of teams) {
      if (sid <= 0 || sid >= RELATION_SIZE) continue;
      let bucket = byTeam.get(team);
      if (!bucket) {
        bucket = [];
        byTeam.set(team, bucket);
      }
      bucket.push(sid);
    }
    for (const members of byTeam.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]!,
            b = members[j]!;
          matrix[a * RELATION_SIZE + b] = RELATION_FRIENDLY;
          matrix[b * RELATION_SIZE + a] = RELATION_FRIENDLY;
        }
      }
    }
  }

  return { matrix, size: RELATION_SIZE };
}

/** Build a smallID→team map from a player list. Skips players with no team. */
export function buildTeamMap(
  players: readonly PlayerStatic[],
): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const p of players) {
    if (p.team !== null) m.set(p.smallID, p.team);
  }
  return m;
}
