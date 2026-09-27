import { GUN_DAMAGE, GUN_RANGE } from "./constants.js";

/** Structural, so it runs on schema instances in the room and plain objects in tests. */
export interface DamageSourceGun { x: number; y: number; }
export interface DamageTarget { role: string; x: number; y: number; health: number; }

/**
 * Applies one shot that `stepGunFiring` just reported. Revalidates at fire
 * time rather than trusting the gun's targetId: the target must exist, be
 * the Ghost, and still be within GUN_RANGE of the gun (pure distance, same
 * rule as targeting). Returns whether damage was applied.
 */
export function applyGunDamage(gun: DamageSourceGun, target: DamageTarget | undefined): boolean {
  if (!target) { return false; }
  if (target.role !== "ghost") { return false; }

  const dx = target.x - gun.x;
  const dy = target.y - gun.y;
  if (Math.sqrt(dx * dx + dy * dy) > GUN_RANGE) { return false; }

  target.health = Math.max(0, target.health - GUN_DAMAGE);
  return true;
}
