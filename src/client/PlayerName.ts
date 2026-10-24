import { ANON_WORDS, anonWordName } from "@openfront/shared/AnonNames";
import { MAX_USERNAME_LENGTH } from "./validations/username";

/** Which branch of the precedence produced the name. */
export type PlayerNameSource = "verified" | "stored" | "persona" | "generated";

export interface ResolvedPlayerName {
  name: string;
  source: PlayerNameSource;
  /** Always false: there are no accounts to verify a name against. */
  verified: boolean;
}

// Trim rather than reject: a name stored before the cap would otherwise fail
// validation and block play.
export function clampUsername(name: string): string {
  return name.length > MAX_USERNAME_LENGTH
    ? name.slice(0, MAX_USERNAME_LENGTH).trim()
    : name;
}

/** A generated name, for a player with nothing stored. */
export function fallbackPlayerName(): ResolvedPlayerName {
  return { name: genAnonUsername(), source: "generated", verified: false };
}

// A memorable anonymous username: "Anon" + animal (+ digit). Rejection-sample
// a uniform slot in [0, bound) from the CSPRNG: drawing a raw uint32 and taking
// `% bound` would be very slightly biased.
export function genAnonUsername(): string {
  const bound = ANON_WORDS.length * 10;
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buf = new Uint32Array(1);
  let rand: number;
  do {
    crypto.getRandomValues(buf);
    rand = buf[0] ?? 0;
  } while (rand >= limit);
  return `Anon${anonWordName(rand % bound)}`;
}
