/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

/**
 * Everything in this file derives from one tile size. Server and client
 * share this coordinate space directly — no scaling/conversion anywhere.
 */
export const TILE_SIZE = 60;

/** Half-extent of the player's 32x32 sprite/physics body (see Player.ts). */
export const PLAYER_HALF = 16;

/** Units per second at full stick. */
export const PLAYER_SPEED = 260;

// ============================================================
// ARENA
// ============================================================

/**
 * The whole world is a 32x24 tile grid — large enough that the four rooms
 * no longer fill most of the screen, leaving real open space around them
 * for a future Ghost to move through. The outermost ring (column 0/31,
 * row 0/23) is the arena boundary; everything else is playable. This is
 * exactly the same "outer ring = boundary" pattern used for each room
 * below, just one scale up.
 */
export const ARENA_COLUMNS = 32;
export const ARENA_ROWS = 24;
export const ARENA_WIDTH = ARENA_COLUMNS * TILE_SIZE;  // 1920
export const ARENA_HEIGHT = ARENA_ROWS * TILE_SIZE;    // 1440

/**
 * Playable movement bounds — one tile inside the boundary ring on every
 * side. `stepEntity()` in movement.ts enforces exactly this rectangle;
 * nothing else about room geometry affects movement yet (Milestone 6B).
 */
export const ARENA_LEFT = TILE_SIZE;                        // 60
export const ARENA_TOP = TILE_SIZE;                         // 60
export const ARENA_RIGHT = (ARENA_COLUMNS - 1) * TILE_SIZE; // 1860
export const ARENA_BOTTOM = (ARENA_ROWS - 1) * TILE_SIZE;   // 1380

export const ARENA_CENTER_X = ARENA_WIDTH / 2;  // 960
export const ARENA_CENTER_Y = ARENA_HEIGHT / 2; // 720

// ============================================================
// ROOMS
// ============================================================

/**
 * Each room is a 10x7 tile grid, and — like the arena above — its OWN
 * outer ring is the room's wall. The floor/interior a player can actually
 * stand on is the inner 8x5. This is a deliberate reconciliation: the
 * original single room drew its wall ring OUTSIDE its 10x7 floor (a 12x9
 * total footprint), but that doesn't fit the mandated tile math here — a
 * 12-wide room would leave a 0-tile gap between rooms 1 and 2, not the
 * specified 2-tile gap. Treating the wall ring as the room's own outer
 * ring (not an addition to it) is the only interpretation consistent with
 * the exact room positions and gaps below.
 */
export const ROOM_WIDTH_TILES = 10;
export const ROOM_HEIGHT_TILES = 7;
export const ROOM_WIDTH = ROOM_WIDTH_TILES * TILE_SIZE;   // 600
export const ROOM_HEIGHT = ROOM_HEIGHT_TILES * TILE_SIZE; // 420

/** Local column (0..9) the door sits on, in the room's bottom wall row. */
export const ROOM_DOOR_COLUMN = 5;

/** Local tile (within the 8x5 interior) the bed occupies. */
export const ROOM_BED_TILE = { column: 5, row: 2 };

/**
 * Top-left tile of each of the four rooms. Solved so both axes divide the
 * playable interior exactly, with a 4-tile gap between neighboring rooms
 * (within the requested 3-4 tile range) and symmetric margins to the
 * boundary ring:
 *
 *   columns: margin 3 | room 10 | gap 4 | room 10 | margin 3  = 30 (interior width)
 *   rows:    margin 2 | room 7  | gap 4 | room 7  | margin 2  = 22 (interior height)
 *
 * The vertical margin (2 tiles) is the one dimension that couldn't reach
 * the same "several tiles" comfort as the rest — 24 rows total only
 * leaves 8 spare after two 7-tile room rows and a 4-tile gap. Flagged
 * here rather than silently shrunk further.
 */
export const ROOM_POSITIONS: ReadonlyArray<{ tileX: number; tileY: number }> = [
  { tileX: 4, tileY: 3 },   // Room 1: top-left
  { tileX: 18, tileY: 3 },  // Room 2: top-right
  { tileX: 4, tileY: 14 },  // Room 3: bottom-left
  { tileX: 18, tileY: 14 }, // Room 4: bottom-right
];

/** The one place tile coordinates become pixel coordinates. */
export function tileToPixel(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE, y: tileY * TILE_SIZE };
}

/** Top-left pixel corner of a room. */
export function getRoomPixelPosition(room: { tileX: number; tileY: number }): { x: number; y: number } {
  return tileToPixel(room.tileX, room.tileY);
}

/** A room's door, as a pixel centerpoint — same formula for all four rooms. */
export function getRoomDoorPixel(room: { tileX: number; tileY: number }): { x: number; y: number } {
  const origin = getRoomPixelPosition(room);
  return {
    x: origin.x + ROOM_DOOR_COLUMN * TILE_SIZE + TILE_SIZE / 2,
    y: origin.y + (ROOM_HEIGHT_TILES - 1) * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** A room's bed, as a pixel centerpoint — same formula for all four rooms. */
export function getRoomBedPixel(room: { tileX: number; tileY: number }): { x: number; y: number } {
  const origin = getRoomPixelPosition(room);
  return {
    x: origin.x + ROOM_BED_TILE.column * TILE_SIZE + TILE_SIZE / 2,
    y: origin.y + ROOM_BED_TILE.row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * Server-authoritative door-toggle interaction radius. There is currently
 * one shared `doorOpen` state (MyRoomState), reachable from any of the
 * four rooms' doors — see MyRoom.ts's `toggleDoor` handler. Matches
 * GameScene's own proximity check, used only for its UI prompt.
 */
export const DOOR_INTERACT_RADIUS = 75;

// ============================================================
// SPAWN
// ============================================================

/**
 * Four spawn tiles in the center 2x2 of the open plaza where the
 * horizontal gap (columns 14-17, between rooms 1/2 and 3/4) crosses the
 * vertical gap (rows 10-13, between rooms 1/3 and 2/4) — outside every
 * room, well inside the boundary. No Math.random(); MyRoom.onJoin cycles
 * through these by join order.
 */
export const SPAWN_TILES: ReadonlyArray<{ tileX: number; tileY: number }> = [
  { tileX: 15, tileY: 11 },
  { tileX: 16, tileY: 11 },
  { tileX: 15, tileY: 12 },
  { tileX: 16, tileY: 12 },
];

/** Spawn pixel = tile CENTER (players render from their center point). */
export function getSpawnPixel(tile: { tileX: number; tileY: number }): { x: number; y: number } {
  return {
    x: tile.tileX * TILE_SIZE + TILE_SIZE / 2,
    y: tile.tileY * TILE_SIZE + TILE_SIZE / 2,
  };
}
