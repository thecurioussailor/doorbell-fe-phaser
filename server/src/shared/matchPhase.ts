/**
 * "lobby"       = players gathering and readying up; no roles yet,
 * "starting"    = host's START GAME accepted; room locked (10B turns this
 *                 into role assignment + preparation),
 * "preparation" = Ghost held at spawn, Defenders set up,
 * "active"      = Ghost released. Only ever moves forward.
 */
export type MatchPhase = "lobby" | "starting" | "preparation" | "active";

// Absorbs float error from summing tick deltas (750 x 1000/30 is not
// exactly 25000), so the transition lands on the tick the timer truly ends.
const TIMER_EPSILON_MS = 1e-6;

/**
 * One server tick of the phase clock. Only "preparation" counts down;
 * every other phase is returned unchanged, so "active" can never revert.
 */
export function stepMatchPhase(
  phase: MatchPhase,
  preparationRemainingMs: number,
  dtMs: number,
): { phase: MatchPhase; preparationRemainingMs: number } {
  if (phase !== "preparation") {
    return { phase, preparationRemainingMs };
  }

  const remaining = preparationRemainingMs - dtMs;

  if (remaining <= TIMER_EPSILON_MS) {
    return { phase: "active", preparationRemainingMs: 0 };
  }

  return { phase: "preparation", preparationRemainingMs: remaining };
}
