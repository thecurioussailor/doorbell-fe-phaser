import { ARENA_LEFT, ARENA_TOP, ARENA_RIGHT, ARENA_BOTTOM, PLAYER_HALF, PLAYER_SPEED } from "./constants.js";

/**
 * Structural types on purpose: the same step runs on a server Schema instance
 * and on the client reconciler's plain predicted copy, with no schema runtime
 * involved in the simulation.
 */
export interface EntityState { x: number; y: number; vx: number; vy: number; }
export interface MoveInputLike { moveX: number; moveY: number; }

const clamp = (value: number, min: number, max: number) =>
  (value < min ? min : value > max ? max : value);

/**
 * The single movement step, run identically by the server (once per received
 * input) and by the client reconciler (predict, then replay on rollback).
 *
 * Pure function of (state, input, dt): no clocks, no randomness, no reads
 * outside its arguments. That is the whole contract — break it and the client's
 * prediction drifts from the server every time.
 */
export function stepEntity(entity: EntityState, input: MoveInputLike, dt: number): void {
  let dirX = input.moveX;
  let dirY = input.moveY;

  // Normalize the diagonal, so it isn't faster than a straight line.
  if (dirX !== 0 && dirY !== 0) {
    dirX *= Math.SQRT1_2;
    dirY *= Math.SQRT1_2;
  }

  let vx = dirX * PLAYER_SPEED;
  let vy = dirY * PLAYER_SPEED;

  const x = entity.x + vx * dt;
  const y = entity.y + vy * dt;

  // Milestone 5: one outer arena boundary, no bedroom/gate carve-out.
  // Bedroom/door wall collision returns as separate gameplay geometry later.
  const clampedX = clamp(x, ARENA_LEFT + PLAYER_HALF, ARENA_RIGHT - PLAYER_HALF);
  const clampedY = clamp(y, ARENA_TOP + PLAYER_HALF, ARENA_BOTTOM - PLAYER_HALF);

  // Hitting a wall also kills the velocity heading into it, so the reconciler
  // replays the same stop the server did.
  if (clampedX !== x) { vx = 0; }
  if (clampedY !== y) { vy = 0; }

  entity.x = clampedX;
  entity.y = clampedY;
  entity.vx = vx;
  entity.vy = vy;
}
