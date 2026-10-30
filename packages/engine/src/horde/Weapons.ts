import { Unit } from "../game/Game";

/**
 * zfront: rules shared by the horde-mode weapons (turrets, and later mortars).
 */

/**
 * Whether a weapon can fire this tick: still standing and finished building.
 * A weapon under construction neither kills nor shows a shot.
 */
export function readyToFire(u: Unit): boolean {
  return u.isActive() && !u.isUnderConstruction();
}
