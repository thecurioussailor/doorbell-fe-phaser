import { schema, t, type SchemaType } from "@colyseus/schema";
import { PLAYER_MAX_HEALTH } from "../../shared/constants.js";
import type { MatchPhase } from "../../shared/matchPhase.js";

/**
 * One input frame, consumed by `Room.defineInput()`. Flat primitives only, and
 * deliberately minimal:
 *   - no `seq`  — the engine's input counter is the sequence
 *   - no `dt`   — fixed timestep: one input advances exactly one step
 *   - no time   — the SDK stamps lag-comp timing on the wire envelope
 *
 * `int8<-1 | 0 | 1>` narrows the type for your code; the room's `sanitize`
 * clamp is what actually enforces it against a modified client.
 */
export const MoveInput = schema({
  moveX: t.int8<-1 | 0 | 1>(),
  moveY: t.int8<-1 | 0 | 1>(),
});
export type MoveInput = SchemaType<typeof MoveInput>;

export const Player = schema({
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),

  // Authoritative room membership, derived server-side from x/y (see
  // getRoomIndexAtPosition) — never trust a client-claimed roomIndex.
  // -1 means "in the open arena, not inside any room."
  roomIndex: t.int8().default(-1),

  // Authoritative sleeping state — the server, not the client, decides
  // this (see MyRoom.ts's "toggleSleep" message handler).
  sleeping: t.boolean().default(false),

  // Authoritative coin balance. Earned only server-side (one per second
  // while sleeping — see MyRoom.ts's step()) and spent only server-side
  // (a successful "build" message) — a client never sets this directly,
  // and a build request never carries a claimed balance.
  coins: t.number().default(0),

  // Public, not secret. Nothing assigns "ghost" yet — role assignment
  // comes with match start in a later milestone.
  role: t.string<"defender" | "ghost">().default("defender"),

  // Server-only mutation: reduced by shared/gunDamage.ts on a real gun
  // shot, clamped at 0. Nothing happens at 0 yet (no death/respawn).
  maxHealth: t.number().default(PLAYER_MAX_HEALTH),
  health: t.number().default(PLAYER_MAX_HEALTH),
});
export type Player = SchemaType<typeof Player>;

// One built defense. Created only by MyRoom's "build" handler; x/y are
// derived server-side from roomIndex + tileIndex, never client-supplied.
export const Gun = schema({
  id: t.string(),
  roomIndex: t.int8(),
  tileIndex: t.int8(),
  x: t.number(),
  y: t.number(),
  type: t.string().default("basic"),

  // Session id of the Ghost this gun is currently targeting, or "" for
  // none. Recomputed server-side every tick (see MyRoom.updateGunTargets).
  targetId: t.string().default(""),

  // Increments by 1 every time this gun fires (see shared/gunFiring.ts).
  // The only public firing signal; the cooldown itself stays server-only.
  fireSequence: t.number().default(0),
});
export type Gun = SchemaType<typeof Gun>;

export const MyRoomState = schema({

  players: t.map(Player),

  // One independent door state per room, indexed exactly like
  // server/src/shared/constants.ts ROOM_POSITIONS (doorsOpen[i] is room
  // i's door). The server owns this; clients only ever request a toggle
  // ("toggleDoor" message, { roomIndex }) and react to the synchronized
  // value. Populated with 4 `false` entries in MyRoom.onCreate().
  doorsOpen: t.array("boolean"),

  // Parallel to doorsOpen, one lock flag per room. A locked door rejects
  // every toggleDoor request regardless of who sends it (see MyRoom.ts).
  // Set true the moment a player starts sleeping in that room, false again
  // only when that player wakes — never when the door itself is toggled.
  doorsLocked: t.array("boolean"),

  // Flat, one entry per build-tile slot across all four rooms — index
  // `roomIndex * BUILD_TILES_PER_ROOM + tileIndex` (see
  // server/src/shared/constants.ts ROOM_BUILD_TILES/BUILD_TILES_PER_ROOM).
  // True once something has been built there — the occupancy check for
  // placement validation. Populated with BUILD_TILES_PER_ROOM * 4 `false`
  // entries in MyRoom.onCreate().
  buildTilesOccupied: t.array("boolean"),

  // Every built gun, keyed by its server-generated id ("gun-1", ...).
  guns: t.map(Gun),

  // Server-owned match phase — see shared/matchPhase.ts. Clients only read it.
  phase: t.string<MatchPhase>().default(""),

  // Informational countdown for the HUD, whole seconds, updated only when
  // it changes. The server's own ms timer (MyRoom) is what ends preparation.
  preparationSecondsLeft: t.int8().default(0),

});
export type MyRoomState = SchemaType<typeof MyRoomState>;
