import version from "resources/version.txt?raw";
import { ClientEnv } from "./ClientEnv";

// A build HAS a version only if it was tagged. resources/version.txt ships as
// the placeholder "x.xx.xx" and only a tagged deploy overwrites it:
// .github/workflows/release.yml hands build.sh a third argument, which
// build.sh writes to the file, while every untagged deploy goes through
// build-deploy.sh, which passes two arguments and leaves the placeholder in
// the tree. So the footer read "vx.xx.xx" on every nightly, every
// staging deploy and every Steam depot build -- a label naming no build at
// all, and the one thing a player is asked to quote in a bug report.
const VERSION_RE = /^v?\d+\.\d+\.\d+/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const SHORT_COMMIT_LENGTH = 7;

/**
 * The label identifying this client build.
 *
 * Show the version when the build has one, and the 7-char commit when it does
 * not -- the same rule the Electron shell applies to its own half of the
 * footer line (OPE-358), so "v0.33.18 (Steam v0.1.0)" and
 * "bf739f8 (Steam a1b2c3d)" are both self-consistent rather than one half
 * naming a build and the other a placeholder.
 *
 * Pure, and takes both inputs, so it can be tested on its own.
 */
export function composeGameVersion(
  rawVersion: string,
  gitCommit: string,
): string {
  const trimmed = rawVersion.trim();
  const withV = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  if (VERSION_RE.test(trimmed)) return withV;

  // Untagged, so the commit is the only thing identifying this build.
  const commit = gitCommit.trim();
  if (SHA_RE.test(commit)) {
    return commit.slice(0, SHORT_COMMIT_LENGTH).toLowerCase();
  }
  // Not a sha, but not nothing either: "DEV" from the local dev server, or
  // the "desktop" placeholder an Electron shell predating OPE-358 injects.
  // Both say strictly more than the version placeholder does.
  if (commit !== "") return commit;
  // Unreachable in a live client -- ClientEnv.get() throws long before this
  // if BOOTSTRAP_CONFIG is absent -- but the label must never come back
  // blank, so fall back to whatever the file held.
  return withV;
}

/**
 * composeGameVersion applied to this page.
 *
 * Called at render time rather than evaluated at module scope: the commit
 * comes from BOOTSTRAP_CONFIG, which the server injects into the page, and
 * which is not guaranteed to exist when this module is first imported.
 */
export function currentGameVersion(): string {
  return composeGameVersion(version, currentGitCommit());
}

// ClientEnv.get() throws when BOOTSTRAP_CONFIG is missing. A cosmetic version
// label must never be the thing that takes the page down, so read it
// defensively and let composeGameVersion treat "" as "no commit known".
function currentGitCommit(): string {
  try {
    return ClientEnv.gitCommit();
  } catch {
    return "";
  }
}
