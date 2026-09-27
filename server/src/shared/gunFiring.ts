import { GUN_FIRE_RATE_MS } from "./constants.js";

/** Structural, so it runs on schema Guns in the room and plain objects in tests. */
export interface FiringGun {
  id: string;
  targetId: string;
  fireSequence: number;
}

// Absorbs float error from summing tick deltas (30 x 1000/30 is not exactly
// 1000), so a shot lands on the tick the cooldown truly reaches zero.
const COOLDOWN_EPSILON_MS = 1e-6;

/**
 * One firing step for every gun, run after targeting. `cooldownsMs` is
 * server-only state keyed by gun id: remaining ms until the gun may fire
 * again, where 0 (or a missing entry) means ready — so a gun acquiring its
 * first target fires on that same step.
 *
 * The cooldown counts down every step whether or not there's a target, and
 * is clamped at 0: idle time can't bank extra shots, and dropping and
 * reacquiring a target can't skip a cooldown already in progress.
 *
 * Returns the guns that fired on this step — the only input damage uses.
 */
export function stepGunFiring<G extends FiringGun>(
  guns: Iterable<G>,
  playerExists: (sessionId: string) => boolean,
  cooldownsMs: Map<string, number>,
  dtMs: number,
): G[] {
  const liveGunIds = new Set<string>();
  const fired: G[] = [];

  for (const gun of guns) {
    liveGunIds.add(gun.id);

    if (gun.targetId !== "" && !playerExists(gun.targetId)) {
      gun.targetId = "";
    }

    let cooldown = cooldownsMs.get(gun.id) ?? 0;

    if (gun.targetId !== "" && cooldown <= COOLDOWN_EPSILON_MS) {
      gun.fireSequence += 1;
      cooldown = GUN_FIRE_RATE_MS;
      fired.push(gun);
    }

    cooldownsMs.set(gun.id, Math.max(0, cooldown - dtMs));
  }

  for (const gunId of cooldownsMs.keys()) {
    if (!liveGunIds.has(gunId)) {
      cooldownsMs.delete(gunId);
    }
  }

  return fired;
}
