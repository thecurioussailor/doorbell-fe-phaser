import { schema, t, type SchemaType } from "@colyseus/schema";

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
});
export type Player = SchemaType<typeof Player>;

export const MyRoomState = schema({

  players: t.map(Player),

  // One independent door state per room, indexed exactly like
  // server/src/shared/constants.ts ROOM_POSITIONS (doorsOpen[i] is room
  // i's door). The server owns this; clients only ever request a toggle
  // ("toggleDoor" message, { roomIndex }) and react to the synchronized
  // value. Populated with 4 `false` entries in MyRoom.onCreate().
  doorsOpen: t.array("boolean"),

});
export type MyRoomState = SchemaType<typeof MyRoomState>;
