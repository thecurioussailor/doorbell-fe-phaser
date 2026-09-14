import {
  ARENA_LEFT, ARENA_TOP, ARENA_RIGHT, ARENA_BOTTOM,
  ROOM_POSITIONS, ROOM_WIDTH, ROOM_HEIGHT, ROOM_DOOR_COLUMN,
  TILE_SIZE, PLAYER_HALF, PLAYER_SPEED,
  getRoomPixelPosition,
} from "./constants.js";

/**
 * Structural types on purpose: the same step runs on a server Schema instance
 * and on the client reconciler's plain predicted copy, with no schema runtime
 * involved in the simulation.
 */
export interface EntityState { x: number; y: number; vx: number; vy: number; }
export interface MoveInputLike { moveX: number; moveY: number; }

const clamp = (value: number, min: number, max: number) =>
  (value < min ? min : value > max ? max : value);

interface Rect { left: number; top: number; right: number; bottom: number; }

/** AABB overlap between a `PLAYER_HALF`-radius box centered at (px, py) and a rect. */
function overlapsRect(px: number, py: number, rect: Rect): boolean {
  return (
    px - PLAYER_HALF < rect.right &&
    px + PLAYER_HALF > rect.left &&
    py - PLAYER_HALF < rect.bottom &&
    py + PLAYER_HALF > rect.top
  );
}

/**
 * One room's solid wall geometry, as up to 5 rectangular bands: top wall
 * (full width), left/right walls (interior rows only — corners are already
 * covered by the top band), and the bottom wall split around the door
 * column (2 side segments, always solid, plus the door segment itself,
 * solid only while that room's door is closed). This is the exact tile
 * layout GameScene draws — same source of truth, just expressed as
 * pixel rectangles for collision instead of individual tile draws.
 */
function getRoomWallBands(room: { tileX: number; tileY: number }, doorOpen: boolean): Rect[] {
  const origin = getRoomPixelPosition(room);
  const left = origin.x;
  const top = origin.y;
  const right = origin.x + ROOM_WIDTH;
  const bottom = origin.y + ROOM_HEIGHT;

  const bands: Rect[] = [
    { left, top, right, bottom: top + TILE_SIZE },                                   // top wall
    { left, top: top + TILE_SIZE, right: left + TILE_SIZE, bottom: bottom - TILE_SIZE }, // left wall
    { left: right - TILE_SIZE, top: top + TILE_SIZE, right, bottom: bottom - TILE_SIZE }, // right wall
  ];

  const doorLeft = left + ROOM_DOOR_COLUMN * TILE_SIZE;
  const doorRight = doorLeft + TILE_SIZE;
  const bottomWallTop = bottom - TILE_SIZE;

  if (doorLeft > left) {
    bands.push({ left, top: bottomWallTop, right: doorLeft, bottom }); // bottom wall, left of door
  }
  if (doorRight < right) {
    bands.push({ left: doorRight, top: bottomWallTop, right, bottom }); // bottom wall, right of door
  }
  if (!doorOpen) {
    bands.push({ left: doorLeft, top: bottomWallTop, right: doorRight, bottom }); // the door itself
  }

  return bands;
}

/** Does a PLAYER_HALF-radius box at (px, py) overlap any room's solid walls? */
function collidesWithRooms(px: number, py: number, doorsOpen: ArrayLike<boolean>): boolean {
  return ROOM_POSITIONS.some((room, index) => {
    const bands = getRoomWallBands(room, doorsOpen[index] ?? false);
    return bands.some((band) => overlapsRect(px, py, band));
  });
}

/**
 * The single movement step, run identically by the server (once per received
 * input) and by the client reconciler (predict, then replay on rollback).
 *
 * Pure function of (state, input, dt, doorsOpen): no clocks, no randomness,
 * no reads outside its arguments. That is the whole contract — break it and
 * the client's prediction drifts from the server every time. `doorsOpen` is
 * passed explicitly rather than read from anywhere global, so this stays
 * deterministic for a given (state, input, dt, doorsOpen) tuple.
 */
export function stepEntity(
  entity: EntityState,
  input: MoveInputLike,
  dt: number,
  doorsOpen: ArrayLike<boolean> = []
): void {
  let dirX = input.moveX;
  let dirY = input.moveY;

  // Normalize the diagonal, so it isn't faster than a straight line.
  if (dirX !== 0 && dirY !== 0) {
    dirX *= Math.SQRT1_2;
    dirY *= Math.SQRT1_2;
  }

  let vx = dirX * PLAYER_SPEED;
  let vy = dirY * PLAYER_SPEED;

  // X axis first, resolved against the arena boundary and all four rooms.
  let x = clamp(entity.x + vx * dt, ARENA_LEFT + PLAYER_HALF, ARENA_RIGHT - PLAYER_HALF);
  if (collidesWithRooms(x, entity.y, doorsOpen)) {
    x = entity.x;
    vx = 0;
  }

  // Y axis second, resolved using the (possibly wall-stopped) X from above —
  // this is what makes diagonal movement into a wall slide along it instead
  // of freezing both axes outright.
  let y = clamp(entity.y + vy * dt, ARENA_TOP + PLAYER_HALF, ARENA_BOTTOM - PLAYER_HALF);
  if (collidesWithRooms(x, y, doorsOpen)) {
    y = entity.y;
    vy = 0;
  }

  entity.x = x;
  entity.y = y;
  entity.vx = vx;
  entity.vy = vy;
}
