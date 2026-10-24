import type { PlayerState, PlayerStatusData, UnitState } from "../../types";
import { NUKE_TYPES, UT_MIRV_WARHEAD } from "../../types";

/** Unit types that indicate an active nuke is in flight. */
const NUKE_ACTIVE_TYPES: ReadonlySet<string> = new Set([
  ...NUKE_TYPES,
  UT_MIRV_WARHEAD,
]);

const OWNER_MASK = 0xfff;

export interface ComputePlayerStatusOptions {
  /**
   * Local player smallID for computing relative flags. Omit (or set to 0)
   * for replay mode — relative flags will all be false.
   */
  localPlayerSmallID?: number;
  /**
   * Tile state buffer (the same Uint16Array exposed via FrameData.tileState).
   * Used to determine if a nuke's target tile is owned by the local player
   * for the `nukeTargetsMe` flag. If omitted, `nukeTargetsMe` stays false.
   */
  tileState?: Uint16Array;
  /**
   * Current game tick, for the doomsday-clock warn progress.
   */
  tick?: number;
  /**
   * Predicate testing if the local player considers `sid` a transitive target.
   */
  isTransitiveTarget?: (sid: number) => boolean;
  /**
   * Ticks a side must be below the bar before it drains (doomsday clock). Past
   * this the skull holds steady instead of blinking. Omit to treat any flagged
   * side as draining.
   */
  doomsdayClockWarnTicks?: number;
}

/**
 * Compute per-player status flags for the name/status-icon pass.
 *
 * Without `opts.localPlayerSmallID`: replay-path mode. Crown/disconnected/
 * nukeActive are populated; relative flags (target/nukeTargetsMe) are all
 * false.
 *
 * With `opts.localPlayerSmallID`: live mode. Relative flags compare each player
 * against the local player's state to determine target;
 * if `opts.tileState` is also given, `nukeTargetsMe` is set for players
 * whose in-flight nuke is targeting one of the local player's tiles.
 */
export function computePlayerStatus(
  players: ReadonlyMap<number, PlayerState>,
  units: ReadonlyMap<number, UnitState>,
  opts: ComputePlayerStatusOptions = {},
): Map<number, PlayerStatusData> {
  const result = new Map<number, PlayerStatusData>();
  const localPlayerSmallID = opts.localPlayerSmallID ?? 0;
  const localPlayer =
    localPlayerSmallID > 0 ? players.get(localPlayerSmallID) : undefined;
  const tileState = opts.tileState;

  // Crown: alive player with most tiles owned.
  let crownSmallID = -1;
  let maxTiles = 0;
  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    if (ps.tilesOwned > maxTiles) {
      maxTiles = ps.tilesOwned;
      crownSmallID = ps.smallID;
    }
  }

  // Nukes: single pass over units → per-owner flags (avoids the
  // O(players × units) scan of checking every unit per player).
  // Shown during replay too, except the nukeTargetsMe flag.
  const nukeActiveOwners = new Set<number>();
  const nukeTargetsMeOwners = new Set<number>();
  for (const u of units.values()) {
    if (!u.isActive || !NUKE_ACTIVE_TYPES.has(u.unitType)) continue;
    nukeActiveOwners.add(u.ownerID);
    if (
      localPlayerSmallID > 0 &&
      tileState !== undefined &&
      u.targetTile !== null &&
      (tileState[u.targetTile] & OWNER_MASK) === localPlayerSmallID
    ) {
      nukeTargetsMeOwners.add(u.ownerID);
    }
  }

  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    const sid = ps.smallID;
    const crown = sid === crownSmallID;
    const disconnected = ps.isDisconnected;
    const inDoomsdayClock = ps.inDoomsdayClock;
    // Past the warn grace the side is actively bleeding troops; the skull holds
    // steady then (vs blinking while merely in danger).
    const doomsdayClockUnderTicks =
      (opts.tick ?? 0) - ps.markedDoomsdayClockTick;
    const doomsdayClockWarnTicks = opts.doomsdayClockWarnTicks ?? 0;
    const doomsdayClockDraining =
      inDoomsdayClock && doomsdayClockUnderTicks >= doomsdayClockWarnTicks;
    // Red, static skull. From the sim — see PlayerImpl.isDecaying.
    const doomsdayClockDecaying = inDoomsdayClock && ps.isDecaying;
    // How far through the warn countdown (0->1); the danger skull blinks faster
    // as this nears 1, i.e. as the side approaches draining.
    const doomsdayClockWarnProgress =
      inDoomsdayClock && doomsdayClockWarnTicks > 0
        ? Math.max(
            0,
            Math.min(1, doomsdayClockUnderTicks / doomsdayClockWarnTicks),
          )
        : 0;

    // Relative flags
    const nukeActive = nukeActiveOwners.has(sid);
    const nukeTargetsMe = nukeTargetsMeOwners.has(sid);
    let target = false;

    // Flags which are only meaningful when there's a local player,
    // and we're not looking at the local player itself.
    if (localPlayer !== undefined && sid !== localPlayerSmallID) {
      target = opts.isTransitiveTarget
        ? opts.isTransitiveTarget(sid)
        : localPlayer.targets.includes(sid);
    }

    if (
      crown ||
      disconnected ||
      inDoomsdayClock ||
      nukeActive ||
      target ||
      nukeTargetsMe
    ) {
      result.set(sid, {
        crown,
        disconnected,
        inDoomsdayClock,
        doomsdayClockDraining,
        doomsdayClockDecaying,
        doomsdayClockWarnProgress,
        target,
        nukeActive,
        nukeTargetsMe,
      });
    }
  }
  return result;
}
