import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { MyRoomState, Player, MoveInput } from "./schema/MyRoomState.js";
import { stepEntity } from "../shared/movement.js";
import {
  TICK_RATE, SPAWN_TILES, getSpawnPixel,
  ROOM_POSITIONS, getRoomDoorPixel, DOOR_INTERACT_RADIUS,
} from "../shared/constants.js";

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
  // Milestone 5: the room is sized for exactly the 4 players the arena
  // has deterministic spawn slots for.
  maxClients = 4;
  state = new MyRoomState({ doorOpen: false });

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
     * The client only ever REQUESTS a toggle — it never sets doorOpen
     * itself. Validated here against the requesting player's own
     * authoritative server-side position (never a client-supplied one).
     * There is one shared doorOpen state, reachable from any of the four
     * rooms' doors — standing near ANY of them and pressing E toggles the
     * same state for all four. (Four independent door states is deferred
     * — that's room-specific gameplay, out of scope for this milestone.)
     */
    toggleDoor: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) { return; }

      const isNearAnyDoor = ROOM_POSITIONS.some((room) => {
        const door = getRoomDoorPixel(room);
        return Math.hypot(player.x - door.x, player.y - door.y) <= DOOR_INTERACT_RADIUS;
      });

      if (!isNearAnyDoor) { return; }

      this.state.doorOpen = !this.state.doorOpen;
    },
  };

  onCreate(options: any) {
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
   * does not move — an empty tick advances no one.
   */
  private step(ctx: StepContext) {
    for (const [sessionId, player] of this.state.players) {
      const channel = this.inputs.get(sessionId);
      if (!channel) { continue; }

      for (const input of channel) {
        stepEntity(player, input, ctx.dt);
      }
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
