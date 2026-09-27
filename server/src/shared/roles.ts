/**
 * Picks the one Ghost from the current players, uniformly at random.
 * `random` is injectable (defaults to Math.random) so tests can pin the
 * choice. Returns "" for an empty list.
 */
export function pickGhost(sessionIds: readonly string[], random: () => number = Math.random): string {
  if (sessionIds.length === 0) { return ""; }

  const index = Math.min(Math.floor(random() * sessionIds.length), sessionIds.length - 1);
  return sessionIds[index];
}
