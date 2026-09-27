import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { MyRoomState, Player, MoveInput, Gun } from "./schema/MyRoomState.js";
import { stepEntity } from "../shared/movement.js";
import { stepGunFiring } from "../shared/gunFiring.js";
import { applyGunDamage } from "../shared/gunDamage.js";
import {
  TICK_RATE, SPAWN_TILES, getSpawnPixel,
  ROOM_POSITIONS, getRoomDoorPixel, DOOR_INTERACT_RADIUS,
  getRoomBedPixel, getRoomIndexAtPosition, BED_INTERACT_RADIUS,
  BUILD_TILES_PER_ROOM, GUN_COST, COIN_INTERVAL_MS, getRoomBuildTilePixel, GUN_RANGE,
  MAX_PLAYERS, GHOST_SPAWN_TILE, PREPARATION_DURATION_MS,
} from "../shared/constants.js";
import { pickGhost } from "../shared/roles.js";
import { stepMatchPhase } from "../shared/matchPhase.js";

interface ToggleDoorMessage {
  roomIndex?: number;
}

interface BuildMessage {
  tileIndex?: number;
}

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
  // 4 Defenders + 1 Ghost.
  maxClients = MAX_PLAYERS;
  state = new MyRoomState();

  // Set once, when the room first reaches MAX_PLAYERS (the stand-in for
  // "match start" until the lobby exists). Roles never re-roll after that.
  private rolesAssigned = false;

  // Server-only ms left in preparation; state.preparationSecondsLeft is
  // just its rounded-up display value.
  private preparationRemainingMs = 0;

  // Source of randomness for Ghost selection — replaceable in tests.
  random: () => number = Math.random;

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

  private nextGunId = 1;

  // Server-only remaining cooldown per gun id — see shared/gunFiring.ts.
  private gunCooldownsMs = new Map<string, number>();

  // Per-session accrued sleep time in ms, not yet converted into a whole
  // coin — a plain map alongside `inputs` rather than schema state, since
  // it's bookkeeping for step(), not something any client needs to read.
  private coinAccumulatorsMs = new Map<string, number>();

  messages = {
    // movement arrives through the input buffer above — register handlers here
    // only for things that are not inputs (chat, emotes, …).

    /**
     * The client only ever REQUESTS a toggle for a specific room — it never
     * sets doorsOpen itself and never supplies a door position. Validated
     * here: roomIndex must be a real room, the player must exist, the
     * player's own authoritative server-side position (never a
     * client-supplied one) must be close enough to THAT room's door, and
     * the room must not be locked (a sleeping defender's room — see
     * toggleSleep below). Only that one room's door state changes.
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

      if (this.state.doorsLocked[roomIndex]) { return; }

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
      if (player.role === "ghost") { return; }

      // Waking up never needs a proximity check — keep the current
      // authoritative position, just resume movement. The room's door
      // stays closed but is no longer locked: a defender can now approach
      // and open it normally (it does not auto-open on wake).
      if (player.sleeping) {
        player.sleeping = false;

        if (player.roomIndex !== -1) {
          this.state.doorsLocked[player.roomIndex] = false;
        }

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

      // PLAYER SLEEPS -> ROOM BECOMES OCCUPIED -> DOOR CLOSES -> DOOR LOCKS.
      this.state.doorsOpen[roomIndex] = false;
      this.state.doorsLocked[roomIndex] = true;
    },

    /**
     * The client only ever REQUESTS a build at a `tileIndex` inside ITS OWN
     * current room — it never names a room. The server derives the room
     * from the player's own authoritative `roomIndex` (never a
     * client-supplied one), so a modified client cannot build into a room
     * it doesn't occupy just by naming a different index. Coins are the
     * server's own balance, never a client-claimed one (see Player.coins).
     */
    build: (client: Client, message: BuildMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) { return; }

      // Only the sleeping defender of a room may build in it.
      if (player.role === "ghost") { return; }
      if (!player.sleeping) { return; }
      if (player.roomIndex < 0) { return; }

      const tileIndex = message?.tileIndex;

      if (
        typeof tileIndex !== "number" ||
        !Number.isInteger(tileIndex) ||
        tileIndex < 0 ||
        tileIndex >= BUILD_TILES_PER_ROOM
      ) {
        return;
      }

      const globalTileIndex = player.roomIndex * BUILD_TILES_PER_ROOM + tileIndex;

      if (this.state.buildTilesOccupied[globalTileIndex]) { return; }
      if (player.coins < GUN_COST) { return; }

      player.coins -= GUN_COST;
      this.state.buildTilesOccupied[globalTileIndex] = true;

      const id = `gun-${this.nextGunId++}`;
      const position = getRoomBuildTilePixel(ROOM_POSITIONS[player.roomIndex], tileIndex);

      this.state.guns.set(id, new Gun({
        id,
        roomIndex: player.roomIndex,
        tileIndex,
        x: position.x,
        y: position.y,
        type: "basic",
      }));
    },
  };

  onCreate(options: any) {
    // Four independent doors, one per ROOM_POSITIONS entry, all starting
    // closed and unlocked.
    this.state.doorsOpen.push(false, false, false, false);
    this.state.doorsLocked.push(false, false, false, false);

    // One occupancy flag per build-tile slot across all four rooms, all
    // starting empty — see MyRoomState.buildTilesOccupied.
    for (let i = 0; i < BUILD_TILES_PER_ROOM * ROOM_POSITIONS.length; i++) {
      this.state.buildTilesOccupied.push(false);
    }

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

    if (!this.rolesAssigned && this.state.players.size === MAX_PLAYERS) {
      this.assignRoles();
    }
  }

  /**
   * Exactly one Ghost, chosen server-side; everyone else stays a Defender
   * (the schema default). The Ghost moves to its own spawn outside every
   * room; Defenders keep wherever they are. Runs once per room.
   */
  private assignRoles() {
    this.rolesAssigned = true;

    const ghostId = pickGhost([...this.state.players.keys()], this.random);

    for (const [sessionId, player] of this.state.players) {
      player.role = sessionId === ghostId ? "ghost" : "defender";
    }

    const ghost = this.state.players.get(ghostId);
    if (ghost) {
      // A player picked while asleep in a room must not leave that room's
      // door locked behind them, or stay "sleeping" as the Ghost.
      if (ghost.sleeping) {
        ghost.sleeping = false;
        if (ghost.roomIndex !== -1) {
          this.state.doorsLocked[ghost.roomIndex] = false;
        }
      }

      const spawn = getSpawnPixel(GHOST_SPAWN_TILE);
      ghost.x = spawn.x;
      ghost.y = spawn.y;
      ghost.vx = 0;
      ghost.vy = 0;
    }

    this.state.phase = "preparation";
    this.preparationRemainingMs = PREPARATION_DURATION_MS;
    this.state.preparationSecondsLeft = Math.ceil(PREPARATION_DURATION_MS / 1000);
  }

  /** Advances the server-owned phase clock; the only place preparation ends. */
  private advancePhase(dtMs: number) {
    const next = stepMatchPhase(this.state.phase, this.preparationRemainingMs, dtMs);
    this.preparationRemainingMs = next.preparationRemainingMs;

    if (next.phase !== this.state.phase) {
      this.state.phase = next.phase;
    }

    const secondsLeft = Math.ceil(next.preparationRemainingMs / 1000);
    if (secondsLeft !== this.state.preparationSecondsLeft) {
      this.state.preparationSecondsLeft = secondsLeft;
    }
  }

  /** The Ghost is held in place until the preparation phase ends. */
  private isFrozen(player: Player): boolean {
    return player.role === "ghost" && this.state.phase === "preparation";
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
    this.coinAccumulatorsMs.delete(client.sessionId);
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
    // First, so the tick on which preparation ends already runs as "active".
    this.advancePhase(ctx.dt * 1000);

    for (const [sessionId, player] of this.state.players) {
      const channel = this.inputs.get(sessionId);

      if (channel) {
        // Inputs are always drained; sleeping players and a frozen Ghost
        // just don't have them applied.
        for (const input of channel) {
          if (!player.sleeping && !this.isFrozen(player)) {
            stepEntity(player, input, ctx.dt, this.state.doorsOpen);
          }
        }
      }

      player.roomIndex = getRoomIndexAtPosition(player.x, player.y);

      // One coin per COIN_INTERVAL_MS of sleep — the same rate the coin
      // display used to accrue purely client-side; only the authority
      // moved, not the economy. Accumulator resets whenever the player
      // isn't sleeping, so a wake/sleep cycle never carries over a
      // fractional head start.
      if (player.sleeping) {
        const accumulatedMs = (this.coinAccumulatorsMs.get(sessionId) ?? 0) + ctx.dt * 1000;
        const earned = Math.floor(accumulatedMs / COIN_INTERVAL_MS);

        if (earned > 0) {
          player.coins += earned;
          this.coinAccumulatorsMs.set(sessionId, accumulatedMs - earned * COIN_INTERVAL_MS);
        } else {
          this.coinAccumulatorsMs.set(sessionId, accumulatedMs);
        }
      } else {
        this.coinAccumulatorsMs.set(sessionId, 0);
      }
    }

    this.updateGunTargets();

    const firedGuns = stepGunFiring(
      this.state.guns.values(),
      (sessionId) => this.state.players.has(sessionId),
      this.gunCooldownsMs,
      ctx.dt * 1000,
    );

    for (const gun of firedGuns) {
      applyGunDamage(gun, this.state.players.get(gun.targetId));
    }
  }

  /**
   * Runs after movement so targets reflect this tick's positions. Pure
   * Euclidean distance on server coordinates — no walls, doors, rooms or
   * line of sight. A Ghost that has left is simply absent from `players`,
   * so every gun clears on the next tick.
   */
  private updateGunTargets() {
    let ghostId = "";
    let ghost: Player | undefined;

    for (const [sessionId, player] of this.state.players) {
      if (player.role === "ghost") {
        ghostId = sessionId;
        ghost = player;
        break;
      }
    }

    // An unreleased Ghost isn't a valid target: no target means no shot,
    // so no damage, for the whole preparation phase.
    if (ghost && this.isFrozen(ghost)) {
      ghost = undefined;
    }

    for (const gun of this.state.guns.values()) {
      if (!ghost) {
        gun.targetId = "";
        continue;
      }

      const dx = ghost.x - gun.x;
      const dy = ghost.y - gun.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      gun.targetId = distance <= GUN_RANGE ? ghostId : "";
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
