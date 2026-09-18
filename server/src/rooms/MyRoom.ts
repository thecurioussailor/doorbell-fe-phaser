import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { MyRoomState, Player, MoveInput } from "./schema/MyRoomState.js";
import { stepEntity } from "../shared/movement.js";
import {
  TICK_RATE, SPAWN_TILES, getSpawnPixel,
  ROOM_POSITIONS, getRoomDoorPixel, DOOR_INTERACT_RADIUS,
  getRoomBedPixel, getRoomIndexAtPosition, BED_INTERACT_RADIUS,
} from "../shared/constants.js";

interface ToggleDoorMessage {
  roomIndex?: number;
}

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
  // Milestone 5: the room is sized for exactly the 4 players the arena
  // has deterministic spawn slots for.
  maxClients = 4;
  state = new MyRoomState();

  /**
   * Per-client input buffer. `sanitize` clamps every field as it is decoded —
   * never trust the wire — and the buffer holds ~2s of inputs at this tick rate
   * so a burst after a stall still replays in order.
   */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 64,
    sanitize: { moveX: [-1, 1], moveY: [-1, 1] },
  });

  private joinCount = 0;

  messages = {
    // movement arrives through the input buffer above — register handlers here
    // only for things that are not inputs (chat, emotes, …).

    /**
     * The client only ever REQUESTS a toggle for a specific room — it never
     * sets doorsOpen itself and never supplies a door position. Validated
     * here: roomIndex must be a real room, the player must exist, and the
     * player's own authoritative server-side position (never a
     * client-supplied one) must be close enough to THAT room's door. Only
     * that one room's door state changes.
     */
    toggleDoor: (client: Client, message: ToggleDoorMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) { return; }

      const roomIndex = message?.roomIndex;

      if (
        typeof roomIndex !== "number" ||
        !Number.isInteger(roomIndex) ||
        roomIndex < 0 ||
        roomIndex >= ROOM_POSITIONS.length
      ) {
        return;
      }

      const door = getRoomDoorPixel(ROOM_POSITIONS[roomIndex]);
      const distance = Math.hypot(player.x - door.x, player.y - door.y);

      if (distance > DOOR_INTERACT_RADIUS) { return; }

      this.state.doorsOpen[roomIndex] = !this.state.doorsOpen[roomIndex];
    },

    /**
     * The client only ever REQUESTS a sleep/wake toggle — no payload, no
     * client-supplied position or room. The server derives everything:
     * room membership from the player's own authoritative x/y, the bed
     * from that room's fixed geometry, and rejects if too far away or if
     * another player is already sleeping in that room.
     */
    toggleSleep: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) { return; }

      // Waking up never needs a proximity check — keep the current
      // authoritative position, just resume movement.
      if (player.sleeping) {
        player.sleeping = false;
        return;
      }

      const roomIndex = getRoomIndexAtPosition(player.x, player.y);
      if (roomIndex === -1) { return; }

      const bed = getRoomBedPixel(ROOM_POSITIONS[roomIndex]);
      const distance = Math.hypot(player.x - bed.x, player.y - bed.y);
      if (distance > BED_INTERACT_RADIUS) { return; }

      // At most one sleeping player per room — a temporary occupancy
      // rule, not permanent room ownership (that's a later milestone).
      for (const other of this.state.players.values()) {
        if (other !== player && other.sleeping && other.roomIndex === roomIndex) {
          return;
        }
      }

      player.x = bed.x;
      player.y = bed.y;
      player.vx = 0;
      player.vy = 0;
      player.roomIndex = roomIndex;
      player.sleeping = true;
    },
  };

  onCreate(options: any) {
    // Four independent doors, one per ROOM_POSITIONS entry, all starting closed.
    this.state.doorsOpen.push(false, false, false, false);

    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    // Deterministic spawn in the 2x2 open plaza at the arena center — no
    // Math.random(). `% SPAWN_TILES.length` keeps this safe even if more
    // than 4 joins ever happen over the room's lifetime (leaves + rejoins).
    const tile = SPAWN_TILES[this.joinCount % SPAWN_TILES.length];
    this.joinCount++;

    const spawn = getSpawnPixel(tile);

    this.state.players.set(client.sessionId, new Player({
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      roomIndex: -1,
      sleeping: false,
    }));
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  /**
   * One shared `stepEntity` per received input, so the set the client predicted
   * is exactly the set the server applied. A client that sends nothing simply
   * does not move — an empty tick advances no one. A sleeping player's inputs
   * are still drained (so nothing backs up in the buffer while asleep) but
   * never applied — this is the authoritative "sleeping players can't move"
   * rule; the client also stops sending input while sleeping, but the server
   * doesn't rely on that.
   *
   * Room membership is recomputed every tick for every player, regardless of
   * whether they moved, so it never drifts from their actual position.
   */
  private step(ctx: StepContext) {
    for (const [sessionId, player] of this.state.players) {
      const channel = this.inputs.get(sessionId);

      if (channel) {
        for (const input of channel) {
          if (!player.sleeping) {
            stepEntity(player, input, ctx.dt, this.state.doorsOpen);
          }
        }
      }

      player.roomIndex = getRoomIndexAtPosition(player.x, player.y);
    }
  }

  /**
   * Called on any disconnection the client did not ask for — a network blip, a
   * suspended tab, a tunnel change. Holding the seat lets the SDK retry into the
   * same session, so the player keeps their entity and their place in the room.
   */
  onDrop(client: Client, code: CloseCode) {
    // Deliberately not awaited: the framework routes the outcome to onReconnect()
    // or onLeave() by itself. The catch is only here because the promise also
    // rejects when the room is already disposing (server shutdown), which would
    // otherwise surface as an unhandled rejection.
    this.allowReconnection(client, 30).catch(() => {});
  }

  onReconnect(client: Client) {
    console.log(client.sessionId, "reconnected!");
  }
}
