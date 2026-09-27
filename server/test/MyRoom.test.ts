import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoomState, Gun, type MoveInput } from "../src/rooms/schema/MyRoomState.js";
import {
  PLAYER_SPEED, TICK_RATE, ROOM_POSITIONS, GUN_COST, BUILD_TILES_PER_ROOM,
  getRoomBedPixel, getRoomBuildTilePixel, GUN_RANGE, GUN_FIRE_RATE_MS,
  GUN_DAMAGE, PLAYER_MAX_HEALTH,
  MAX_PLAYERS, GHOST_SPAWN_TILE, SPAWN_TILES, getSpawnPixel, getRoomIndexAtPosition,
} from "../src/shared/constants.js";
import { pickGhost } from "../src/shared/roles.js";
import { stepGunFiring, type FiringGun } from "../src/shared/gunFiring.js";
import { applyGunDamage, type DamageTarget } from "../src/shared/gunDamage.js";

// waitForNextPatch() can resolve on a patch already in flight before the
// server change under test, so wait until the client actually sees it.
async function waitForClientState(client: any, predicate: () => boolean, maxPatches = 10) {
  for (let i = 0; i < maxPatches && !predicate(); i++) {
    await client.waitForNextPatch();
  }
  assert.ok(predicate(), `client state did not converge within ${maxPatches} patches`);
}

describe("testing your Colyseus app", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("advances a player from its buffered input", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const client1 = await colyseus.connectTo(room);

    const player = room.state.players.get(client1.sessionId);
    assert.ok(player, "a Player is created on join");
    const startX = player.x;

    const input = client1.input<MoveInput>({ mode: "reliable" });
    input.data.moveX = 1;
    input.data.moveY = 0;
    input.send();

    await room.waitForNextMessage();  // the input reaches the server
    await room.waitForNextTimestep(); // the step that consumes it runs

    assert.ok(player.x > startX, "the buffered input advanced the player");
  });

  it("clamps input that is out of range", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const client1 = await colyseus.connectTo(room);

    const player = room.state.players.get(client1.sessionId);
    const startX = player.x;

    // A modified client claiming a huge axis value: sanitize clamps it to 1.
    const input = client1.input<MoveInput>({ mode: "reliable" });
    input.data.moveX = 100 as any;
    input.send();

    await room.waitForNextMessage();
    await room.waitForNextTimestep();

    // The room steps once per received input, so one input is exactly one step
    // of travel — at moveX clamped to 1, not the 100 the client asked for.
    assert.strictEqual(player.x, startX + PLAYER_SPEED * (1 / TICK_RATE));
  });

  describe("gun building", () => {
    // Puts the player on room 0's bed server-side and sleeps them through
    // the real toggleSleep handler, so the build handler sees a genuinely
    // sleeping defender with an authoritative roomIndex.
    async function sleepInRoom0(room: any, client: any) {
      const player = room.state.players.get(client.sessionId);
      const bed = getRoomBedPixel(ROOM_POSITIONS[0]);
      player.x = bed.x;
      player.y = bed.y;

      client.send("toggleSleep");
      await room.waitForNextMessage();
      assert.strictEqual(player.sleeping, true);
      assert.strictEqual(player.roomIndex, 0);
      return player;
    }

    it("creates an authoritative gun, deducts coins, marks the tile occupied, and syncs to another client", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const clientA = await colyseus.connectTo(room);
      const clientB = await colyseus.connectTo(room);

      const player = await sleepInRoom0(room, clientA);
      player.coins = GUN_COST + 10;

      clientA.send("build", { tileIndex: 3 });
      await room.waitForNextMessage();

      assert.strictEqual(room.state.guns.size, 1);
      const gun = room.state.guns.get("gun-1");
      assert.ok(gun, "gun-1 exists");
      const expected = getRoomBuildTilePixel(ROOM_POSITIONS[0], 3);
      assert.strictEqual(gun.roomIndex, 0);
      assert.strictEqual(gun.tileIndex, 3);
      assert.strictEqual(gun.x, expected.x);
      assert.strictEqual(gun.y, expected.y);
      assert.strictEqual(gun.type, "basic");
      assert.strictEqual(player.coins, 10);
      assert.strictEqual(room.state.buildTilesOccupied[3], true);

      await waitForClientState(clientB, () => clientB.state.guns.has("gun-1"));
      const seenByB = clientB.state.guns.get("gun-1");
      assert.ok(seenByB, "client B received the gun");
      assert.strictEqual(seenByB.x, expected.x);
      assert.strictEqual(seenByB.y, expected.y);
    });

    it("rejects a duplicate build on the same tile without charging", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const client = await colyseus.connectTo(room);

      const player = await sleepInRoom0(room, client);
      player.coins = GUN_COST * 2;

      client.send("build", { tileIndex: 0 });
      await room.waitForNextMessage();
      client.send("build", { tileIndex: 0 });
      await room.waitForNextMessage();

      assert.strictEqual(room.state.guns.size, 1);
      assert.strictEqual(player.coins, GUN_COST);
    });

    it("rejects a build with insufficient coins", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const client = await colyseus.connectTo(room);

      const player = await sleepInRoom0(room, client);
      player.coins = GUN_COST - 1;

      client.send("build", { tileIndex: 0 });
      await room.waitForNextMessage();

      assert.strictEqual(room.state.guns.size, 0);
      assert.strictEqual(player.coins, GUN_COST - 1);
      assert.strictEqual(room.state.buildTilesOccupied[0], false);
    });

    it("rejects a build from an awake player", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const client = await colyseus.connectTo(room);

      const player = room.state.players.get(client.sessionId);
      player.coins = GUN_COST;

      client.send("build", { tileIndex: 0 });
      await room.waitForNextMessage();

      assert.strictEqual(room.state.guns.size, 0);
      assert.strictEqual(player.coins, GUN_COST);
    });

    it("rejects an out-of-range tileIndex", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const client = await colyseus.connectTo(room);

      const player = await sleepInRoom0(room, client);
      player.coins = GUN_COST;

      client.send("build", { tileIndex: BUILD_TILES_PER_ROOM });
      await room.waitForNextMessage();

      assert.strictEqual(room.state.guns.size, 0);
      assert.strictEqual(player.coins, GUN_COST);
    });
  });

  describe("gun targeting", () => {
    // A gun in open arena space, away from every room, so positions below
    // are easy to reason about. Targeting ignores rooms/walls anyway.
    const GUN_X = 960;
    const GUN_Y = 720;

    function addGun(room: any, id: string, x = GUN_X, y = GUN_Y) {
      room.state.guns.set(id, new Gun({ id, roomIndex: 0, tileIndex: 0, x, y, type: "basic" }));
      return room.state.guns.get(id);
    }

    async function connectGhost(room: any, x: number, y: number) {
      const client = await colyseus.connectTo(room);
      const ghost = room.state.players.get(client.sessionId);
      ghost.role = "ghost";
      ghost.x = x;
      ghost.y = y;
      return { client, ghost };
    }

    it("has no target when there is no Ghost", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const defender = await colyseus.connectTo(room);
      const player = room.state.players.get(defender.sessionId);
      player.x = GUN_X + 10;
      player.y = GUN_Y;
      const gun = addGun(room, "gun-a");

      await room.waitForNextTimestep();

      assert.strictEqual(gun.targetId, "", "a defender in range is never a target");
    });

    it("targets a Ghost inside range", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const gun = addGun(room, "gun-a");
      const { client } = await connectGhost(room, GUN_X + 50, GUN_Y + 50);

      await room.waitForNextTimestep();

      assert.strictEqual(gun.targetId, client.sessionId);
    });

    it("targets a Ghost at exactly GUN_RANGE", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const gun = addGun(room, "gun-a");
      // 108² + 144² = 180² exactly — a diagonal, not just an axis-aligned check.
      assert.strictEqual(GUN_RANGE, 180);
      const { client } = await connectGhost(room, GUN_X + 108, GUN_Y + 144);

      await room.waitForNextTimestep();

      assert.strictEqual(gun.targetId, client.sessionId);
    });

    it("does not target a Ghost just beyond GUN_RANGE", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const gun = addGun(room, "gun-a");
      await connectGhost(room, GUN_X + GUN_RANGE + 0.5, GUN_Y);

      await room.waitForNextTimestep();

      assert.strictEqual(gun.targetId, "");
    });

    it("updates targetId as the Ghost moves into and out of range", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const gun = addGun(room, "gun-a");
      const { client, ghost } = await connectGhost(room, GUN_X + 400, GUN_Y);

      await room.waitForNextTimestep();
      assert.strictEqual(gun.targetId, "", "starts out of range");

      ghost.x = GUN_X + 100;
      await room.waitForNextTimestep();
      assert.strictEqual(gun.targetId, client.sessionId, "moved into range");

      ghost.x = GUN_X + 400;
      await room.waitForNextTimestep();
      assert.strictEqual(gun.targetId, "", "moved back out of range");
    });

    it("lets multiple guns target the same Ghost, each by its own distance", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const gunA = addGun(room, "gun-a", GUN_X, GUN_Y);
      const gunB = addGun(room, "gun-b", GUN_X + 200, GUN_Y);
      const gunFar = addGun(room, "gun-far", GUN_X + 600, GUN_Y);
      const { client } = await connectGhost(room, GUN_X + 100, GUN_Y);

      await room.waitForNextTimestep();

      assert.strictEqual(gunA.targetId, client.sessionId);
      assert.strictEqual(gunB.targetId, client.sessionId);
      assert.strictEqual(gunFar.targetId, "");
    });

    it("clears targetId when the Ghost leaves, without removing the gun", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      // Keeps the room alive after the Ghost leaves — an empty room
      // auto-disposes and stops ticking, which isn't the case under test.
      await colyseus.connectTo(room);
      const gun = addGun(room, "gun-a");
      const { client } = await connectGhost(room, GUN_X + 10, GUN_Y);

      await room.waitForNextTimestep();
      assert.strictEqual(gun.targetId, client.sessionId);

      await client.leave();
      while (room.state.players.has(client.sessionId)) {
        await room.waitForNextTimestep();
      }
      // One full tick after removal, so targeting has run without the Ghost.
      await room.waitForNextTimestep();

      assert.strictEqual(gun.targetId, "");
      assert.ok(room.state.guns.get("gun-a"), "the gun itself is kept");
    });

    it("syncs targetId to clients", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const observer = await colyseus.connectTo(room);
      addGun(room, "gun-a");
      const { client: ghostClient } = await connectGhost(room, GUN_X + 10, GUN_Y);

      await room.waitForNextTimestep();
      await waitForClientState(observer, () => observer.state.guns.get("gun-a")?.targetId === ghostClient.sessionId);
    });
  });

  // Deterministic: drives stepGunFiring with exact tick deltas instead of
  // the room's real clock, so cooldown boundaries can be asserted tick by tick.
  describe("gun firing (stepGunFiring)", () => {
    const TICK_MS = 1000 / TICK_RATE;
    const TICKS_PER_SHOT = Math.round(GUN_FIRE_RATE_MS / TICK_MS); // 30 at 30Hz

    function makeGun(id: string, targetId = ""): FiringGun {
      return { id, targetId, fireSequence: 0 };
    }

    function tick(guns: FiringGun[], cooldowns: Map<string, number>, players: string[] = ["ghost"], times = 1) {
      for (let i = 0; i < times; i++) {
        stepGunFiring(guns, (id) => players.includes(id), cooldowns, TICK_MS);
      }
    }

    it("does not fire without a target", () => {
      const gun = makeGun("g1");
      const cooldowns = new Map<string, number>();

      tick([gun], cooldowns, ["ghost"], 100);

      assert.strictEqual(gun.fireSequence, 0);
      assert.strictEqual(cooldowns.get("g1"), 0, "idle cooldown is clamped at 0, not accumulated negative");
    });

    it("fires immediately on first target, 0 -> 1", () => {
      const gun = makeGun("g1", "ghost");
      const cooldowns = new Map<string, number>();

      tick([gun], cooldowns);

      assert.strictEqual(gun.fireSequence, 1);
    });

    it("does not fire again before GUN_FIRE_RATE_MS, and fires again once it elapses", () => {
      const gun = makeGun("g1", "ghost");
      const cooldowns = new Map<string, number>();

      tick([gun], cooldowns);
      assert.strictEqual(gun.fireSequence, 1);

      tick([gun], cooldowns, ["ghost"], TICKS_PER_SHOT - 1);
      assert.strictEqual(gun.fireSequence, 1, "still cooling down one tick short of 1000ms");

      tick([gun], cooldowns);
      assert.strictEqual(gun.fireSequence, 2, "fires exactly when 1000ms have elapsed");

      tick([gun], cooldowns, ["ghost"], TICKS_PER_SHOT * 3);
      assert.strictEqual(gun.fireSequence, 5, "steady rate of one shot per 1000ms, no drift");
    });

    it("stops firing when the target leaves range, and resumes when it returns", () => {
      const gun = makeGun("g1", "ghost");
      const cooldowns = new Map<string, number>();

      tick([gun], cooldowns);
      assert.strictEqual(gun.fireSequence, 1);

      gun.targetId = ""; // what targeting does when the Ghost moves out of range
      tick([gun], cooldowns, ["ghost"], TICKS_PER_SHOT * 5);
      assert.strictEqual(gun.fireSequence, 1, "no shots while untargeted");

      gun.targetId = "ghost";
      tick([gun], cooldowns);
      assert.strictEqual(gun.fireSequence, 2, "reacquired after the cooldown elapsed: fires immediately");
    });

    it("dropping and reacquiring a target cannot skip the cooldown", () => {
      const gun = makeGun("g1", "ghost");
      const cooldowns = new Map<string, number>();

      tick([gun], cooldowns);
      assert.strictEqual(gun.fireSequence, 1);

      gun.targetId = "";
      tick([gun], cooldowns, ["ghost"], 5);
      gun.targetId = "ghost";
      tick([gun], cooldowns);

      assert.strictEqual(gun.fireSequence, 1, "still cooling down from the first shot");
    });

    it("keeps independent cooldowns per gun", () => {
      const gunA = makeGun("a", "ghost");
      const gunB = makeGun("b");
      const cooldowns = new Map<string, number>();

      tick([gunA, gunB], cooldowns, ["ghost"], 10);
      assert.strictEqual(gunA.fireSequence, 1);
      assert.strictEqual(gunB.fireSequence, 0);

      gunB.targetId = "ghost";
      tick([gunA, gunB], cooldowns);
      assert.strictEqual(gunA.fireSequence, 1, "A is still mid-cooldown");
      assert.strictEqual(gunB.fireSequence, 1, "B fires immediately on its own first target");

      // A fired on tick 1, so its next shot is tick 1 + TICKS_PER_SHOT; 11 ticks done.
      tick([gunA, gunB], cooldowns, ["ghost"], TICKS_PER_SHOT - 11);
      assert.strictEqual(gunA.fireSequence, 1, "A one tick short of its cooldown");

      tick([gunA, gunB], cooldowns);
      assert.strictEqual(gunA.fireSequence, 2, "A fires on its own schedule");
      assert.strictEqual(gunB.fireSequence, 1, "B is still mid-cooldown");
    });

    it("removes cooldown state for a gun that no longer exists", () => {
      const gunA = makeGun("a", "ghost");
      const gunB = makeGun("b", "ghost");
      const cooldowns = new Map<string, number>();

      tick([gunA, gunB], cooldowns);
      assert.ok(cooldowns.has("b"));

      tick([gunA], cooldowns);
      assert.strictEqual(cooldowns.has("b"), false);
      assert.ok(cooldowns.has("a"));
    });

    it("does not fire at a target that no longer exists, and clears targetId", () => {
      const gun = makeGun("g1", "ghost");
      const cooldowns = new Map<string, number>();

      tick([gun], cooldowns, []);

      assert.strictEqual(gun.fireSequence, 0);
      assert.strictEqual(gun.targetId, "");
    });
  });

  describe("gun firing (room tick)", () => {
    it("fires automatically from the server tick and syncs fireSequence to clients", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const observer = await colyseus.connectTo(room);
      room.state.guns.set("gun-a", new Gun({ id: "gun-a", roomIndex: 0, tileIndex: 0, x: 960, y: 720, type: "basic" }));
      const gun = room.state.guns.get("gun-a");

      await room.waitForNextTimestep();
      assert.strictEqual(gun.fireSequence, 0, "no Ghost, no shots");

      const ghostClient = await colyseus.connectTo(room);
      const ghost = room.state.players.get(ghostClient.sessionId);
      ghost.role = "ghost";
      ghost.x = 1000;
      ghost.y = 720;

      await room.waitForNextTimestep();
      assert.strictEqual(gun.targetId, ghostClient.sessionId);
      assert.strictEqual(gun.fireSequence, 1, "first shot on the tick the target is acquired");

      await waitForClientState(observer, () => (observer.state.guns.get("gun-a")?.fireSequence ?? 0) >= 1);
    });

    it("ignores a client 'fire' message — no client can trigger firing", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const client = await colyseus.connectTo(room);
      room.state.guns.set("gun-a", new Gun({ id: "gun-a", roomIndex: 0, tileIndex: 0, x: 960, y: 720, type: "basic" }));

      client.send("fire", { gunId: "gun-a" });
      client.send("fireGun", { gunId: "gun-a" });
      await room.waitForNextTimestep();
      await room.waitForNextTimestep();

      assert.strictEqual(room.state.guns.get("gun-a").fireSequence, 0);
    });
  });

  // Deterministic: the same fire-then-damage pipeline MyRoom.step() runs,
  // driven with exact tick deltas instead of the room's real clock.
  describe("gun damage", () => {
    const TICK_MS = 1000 / TICK_RATE;
    const TICKS_PER_SHOT = Math.round(GUN_FIRE_RATE_MS / TICK_MS);

    type TestGun = FiringGun & { x: number; y: number };

    function makeGun(id: string, targetId: string, x = 0, y = 0): TestGun {
      return { id, targetId, fireSequence: 0, x, y };
    }

    function makeGhost(x = 50, y = 0): DamageTarget {
      return { role: "ghost", x, y, health: PLAYER_MAX_HEALTH };
    }

    function tick(guns: TestGun[], players: Map<string, DamageTarget>, cooldowns: Map<string, number>, times = 1) {
      for (let i = 0; i < times; i++) {
        const fired = stepGunFiring(guns, (id) => players.has(id), cooldowns, TICK_MS);
        for (const gun of fired) {
          applyGunDamage(gun, players.get(gun.targetId));
        }
      }
    }

    it("starts every new player at full health", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const client = await colyseus.connectTo(room);
      const player = room.state.players.get(client.sessionId);

      assert.strictEqual(PLAYER_MAX_HEALTH, 100);
      assert.strictEqual(player.health, 100);
      assert.strictEqual(player.maxHealth, 100);
    });

    it("one shot deals exactly GUN_DAMAGE: 100 -> 90", () => {
      const ghost = makeGhost();
      const gun = makeGun("g1", "ghost");

      tick([gun], new Map([["ghost", ghost]]), new Map());

      assert.strictEqual(GUN_DAMAGE, 10);
      assert.strictEqual(gun.fireSequence, 1);
      assert.strictEqual(ghost.health, 90);
    });

    it("steps down 10 per shot, reaches exactly 0 after 10 shots, and never goes negative", () => {
      const ghost = makeGhost();
      const gun = makeGun("g1", "ghost");
      const players = new Map([["ghost", ghost]]);
      const cooldowns = new Map<string, number>();

      tick([gun], players, cooldowns);
      assert.strictEqual(ghost.health, 90);

      for (let shot = 2; shot <= 10; shot++) {
        tick([gun], players, cooldowns, TICKS_PER_SHOT);
        assert.strictEqual(gun.fireSequence, shot);
        assert.strictEqual(ghost.health, 100 - shot * 10);
      }
      assert.strictEqual(ghost.health, 0);

      tick([gun], players, cooldowns, TICKS_PER_SHOT * 3);
      assert.strictEqual(gun.fireSequence, 13, "the gun keeps firing at 0 health");
      assert.strictEqual(ghost.health, 0, "clamped at 0");
    });

    it("damages once per shot, not once per tick", () => {
      const ghost = makeGhost();
      const gun = makeGun("g1", "ghost");

      // 60 ticks = 2s: shots on tick 1 and tick 31 only.
      tick([gun], new Map([["ghost", ghost]]), new Map(), TICKS_PER_SHOT * 2);

      assert.strictEqual(gun.fireSequence, 2);
      assert.strictEqual(ghost.health, 80);
    });

    it("never damages a defender, even if targetId points at one", () => {
      const defender: DamageTarget = { role: "defender", x: 50, y: 0, health: PLAYER_MAX_HEALTH };
      const gun = makeGun("g1", "defender-1");

      tick([gun], new Map([["defender-1", defender]]), new Map());

      assert.strictEqual(gun.fireSequence, 1, "the gun still fired");
      assert.strictEqual(defender.health, PLAYER_MAX_HEALTH, "but dealt no damage");
    });

    it("does not damage a missing target", () => {
      const bystander = makeGhost();
      const gun = makeGun("g1", "gone");

      tick([gun], new Map([["bystander", bystander]]), new Map());

      assert.strictEqual(gun.fireSequence, 0);
      assert.strictEqual(bystander.health, PLAYER_MAX_HEALTH);
      assert.strictEqual(applyGunDamage(gun, undefined), false);
    });

    it("does not damage a Ghost beyond GUN_RANGE, even with a stale targetId", () => {
      const ghost = makeGhost(GUN_RANGE + 1, 0);
      const gun = makeGun("g1", "ghost");

      tick([gun], new Map([["ghost", ghost]]), new Map());

      assert.strictEqual(ghost.health, PLAYER_MAX_HEALTH);
    });

    it("still damages a Ghost at exactly GUN_RANGE", () => {
      const ghost = makeGhost(108, 144); // 108² + 144² = 180²
      const gun = makeGun("g1", "ghost");

      tick([gun], new Map([["ghost", ghost]]), new Map());

      assert.strictEqual(ghost.health, 90);
    });

    it("lets multiple guns damage the same Ghost", () => {
      const ghost = makeGhost(50, 0);
      const gunA = makeGun("a", "ghost", 0, 0);
      const gunB = makeGun("b", "ghost", 100, 0);

      tick([gunA, gunB], new Map([["ghost", ghost]]), new Map());

      assert.strictEqual(ghost.health, 80);
    });

    it("applies damage from the real server tick and syncs health to clients", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const observer = await colyseus.connectTo(room);
      room.state.guns.set("gun-a", new Gun({ id: "gun-a", roomIndex: 0, tileIndex: 0, x: 960, y: 720, type: "basic" }));

      const ghostClient = await colyseus.connectTo(room);
      const ghost = room.state.players.get(ghostClient.sessionId);
      ghost.role = "ghost";
      ghost.x = 1000;
      ghost.y = 720;

      const defender = room.state.players.get(observer.sessionId);
      defender.x = 970; // in range of the gun, but not the Ghost
      defender.y = 720;

      await room.waitForNextTimestep();

      assert.strictEqual(room.state.guns.get("gun-a").fireSequence, 1);
      assert.strictEqual(ghost.health, 90);
      assert.strictEqual(defender.health, PLAYER_MAX_HEALTH);

      await waitForClientState(observer, () => observer.state.players.get(ghostClient.sessionId)?.health === 90);
    });
  });

  describe("pickGhost", () => {
    it("picks by the injected random value and handles the edges", () => {
      const ids = ["a", "b", "c", "d", "e"];
      assert.strictEqual(pickGhost(ids, () => 0), "a");
      assert.strictEqual(pickGhost(ids, () => 0.5), "c");
      assert.strictEqual(pickGhost(ids, () => 0.9999), "e");
      assert.strictEqual(pickGhost(ids, () => 1), "e", "never out of bounds");
      assert.strictEqual(pickGhost([], () => 0), "");
    });
  });

  describe("real human Ghost (5-player match)", () => {
    // Clients in join order; the 5th join triggers role assignment.
    async function connectPlayers(room: any, count: number, options: any = {}) {
      const clients = [];
      for (let i = 0; i < count; i++) {
        clients.push(await colyseus.connectTo(room, options));
      }
      return clients;
    }

    function roles(room: any) {
      return [...room.state.players.values()].map((p: any) => p.role);
    }

    function ghostEntry(room: any): [string, any] {
      const entry = [...room.state.players.entries()].find(([, p]: [string, any]) => p.role === "ghost");
      assert.ok(entry, "a Ghost exists");
      return entry as [string, any];
    }

    it("allows MAX_PLAYERS (5) players and rejects a 6th", async () => {
      assert.strictEqual(MAX_PLAYERS, 5);
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      await connectPlayers(room, 5);

      assert.strictEqual(room.state.players.size, 5);
      await assert.rejects(colyseus.connectTo(room), "the 6th join is refused");
      assert.strictEqual(room.state.players.size, 5);
    });

    it("has no Ghost with 4 or fewer players", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      await connectPlayers(room, 4);

      assert.deepStrictEqual(roles(room), ["defender", "defender", "defender", "defender"]);
    });

    it("assigns exactly 1 Ghost and 4 Defenders at 5 players, across many rooms", async () => {
      const ghostJoinSlots = new Set<number>();

      for (let trial = 0; trial < 12; trial++) {
        const room = await colyseus.createRoom<MyRoomState>("my_room", {});
        const clients = await connectPlayers(room, 5);

        const r = roles(room);
        assert.strictEqual(r.filter((x) => x === "ghost").length, 1);
        assert.strictEqual(r.filter((x) => x === "defender").length, 4);

        const [ghostId] = ghostEntry(room);
        ghostJoinSlots.add(clients.findIndex((c) => c.sessionId === ghostId));

        for (const c of clients) { await c.leave(); }
      }

      assert.ok(ghostJoinSlots.size > 1, "the Ghost isn't always the same join slot");
    });

    it("uses the room's injectable random source for the pick", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      (room as any).random = () => 0.9999;
      const clients = await connectPlayers(room, 5);

      assert.strictEqual(room.state.players.get(clients[4].sessionId).role, "ghost");
    });

    it("keeps roles stable across ticks", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      await connectPlayers(room, 5);
      const before = [...room.state.players.entries()].map(([id, p]: [string, any]) => `${id}:${p.role}`);

      for (let i = 0; i < 10; i++) { await room.waitForNextTimestep(); }

      const after = [...room.state.players.entries()].map(([id, p]: [string, any]) => `${id}:${p.role}`);
      assert.deepStrictEqual(after, before);
    });

    it("ignores a client trying to choose its role", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const clients = await connectPlayers(room, 4, { role: "ghost" });

      for (const c of clients) {
        c.send("setRole", { role: "ghost" });
        c.send("role", "ghost");
      }
      await room.waitForNextTimestep();
      assert.deepStrictEqual(roles(room), ["defender", "defender", "defender", "defender"]);

      await connectPlayers(room, 1, { role: "ghost" });
      assert.strictEqual(roles(room).filter((x) => x === "ghost").length, 1);
    });

    it("places the Ghost at the dedicated spawn, outside every room", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      await connectPlayers(room, 5);
      const [, ghost] = ghostEntry(room);

      const spawn = getSpawnPixel(GHOST_SPAWN_TILE);
      assert.deepStrictEqual(spawn, { x: 150, y: 690 });
      assert.strictEqual(ghost.x, spawn.x);
      assert.strictEqual(ghost.y, spawn.y);
      assert.strictEqual(getRoomIndexAtPosition(ghost.x, ghost.y), -1);
    });

    it("leaves Defenders at their existing join-order spawn tiles", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const clients = await connectPlayers(room, 5);

      clients.forEach((c, joinIndex) => {
        const p = room.state.players.get(c.sessionId);
        if (p.role !== "defender") { return; }
        const spawn = getSpawnPixel(SPAWN_TILES[joinIndex % SPAWN_TILES.length]);
        assert.strictEqual(p.x, spawn.x);
        assert.strictEqual(p.y, spawn.y);
      });
    });

    it("lets the Ghost move through the normal authoritative movement", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const clients = await connectPlayers(room, 5);
      const [ghostId, ghost] = ghostEntry(room);
      const ghostClient = clients.find((c) => c.sessionId === ghostId);
      const startX = ghost.x;

      const input = ghostClient.input<MoveInput>({ mode: "reliable" });
      input.data.moveX = 1;
      input.data.moveY = 0;
      input.send();
      await room.waitForNextMessage();
      await room.waitForNextTimestep();

      assert.strictEqual(ghost.x, startX + PLAYER_SPEED * (1 / TICK_RATE));
    });

    it("rejects Ghost sleep, even standing on a bed", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const clients = await connectPlayers(room, 5);
      const [ghostId, ghost] = ghostEntry(room);
      const ghostClient = clients.find((c) => c.sessionId === ghostId);

      const bed = getRoomBedPixel(ROOM_POSITIONS[0]);
      ghost.x = bed.x;
      ghost.y = bed.y;
      ghostClient.send("toggleSleep");
      await room.waitForNextMessage();

      assert.strictEqual(ghost.sleeping, false);
      assert.strictEqual(room.state.doorsLocked[0], false);
    });

    it("rejects Ghost builds without charging, even if its state were forced to sleeping", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const clients = await connectPlayers(room, 5);
      const [ghostId, ghost] = ghostEntry(room);
      const ghostClient = clients.find((c) => c.sessionId === ghostId);

      // Isolate the role check: satisfy every other build precondition.
      const bed = getRoomBedPixel(ROOM_POSITIONS[0]);
      ghost.x = bed.x;
      ghost.y = bed.y;
      ghost.roomIndex = 0;
      ghost.sleeping = true;
      ghost.coins = GUN_COST * 2;

      ghostClient.send("build", { tileIndex: 0 });
      await room.waitForNextMessage();

      assert.strictEqual(room.state.guns.size, 0);
      assert.strictEqual(ghost.coins, GUN_COST * 2);
      assert.strictEqual(room.state.buildTilesOccupied[0], false);
    });

    it("still lets a Defender sleep and build in a 5-player match", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      const clients = await connectPlayers(room, 5);
      const defenderClient = clients.find((c) => room.state.players.get(c.sessionId).role === "defender");
      const defender = room.state.players.get(defenderClient.sessionId);

      const bed = getRoomBedPixel(ROOM_POSITIONS[1]);
      defender.x = bed.x;
      defender.y = bed.y;
      defenderClient.send("toggleSleep");
      await room.waitForNextMessage();
      assert.strictEqual(defender.sleeping, true);
      assert.strictEqual(defender.roomIndex, 1);

      defender.coins = GUN_COST;
      defenderClient.send("build", { tileIndex: 2 });
      await room.waitForNextMessage();

      assert.strictEqual(room.state.guns.size, 1);
      assert.strictEqual(defender.coins, 0);
      assert.strictEqual(room.state.buildTilesOccupied[1 * BUILD_TILES_PER_ROOM + 2], true);
    });

    it("lets existing guns target and damage the real Ghost", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      await connectPlayers(room, 5);
      const [ghostId, ghost] = ghostEntry(room);

      room.state.guns.set("gun-a", new Gun({
        id: "gun-a", roomIndex: 0, tileIndex: 0, x: ghost.x + 100, y: ghost.y, type: "basic",
      }));
      await room.waitForNextTimestep();

      const gun = room.state.guns.get("gun-a");
      assert.strictEqual(gun.targetId, ghostId);
      assert.strictEqual(gun.fireSequence, 1);
      assert.strictEqual(ghost.health, PLAYER_MAX_HEALTH - GUN_DAMAGE);
    });

    it("wakes a player picked as Ghost while asleep and unlocks their room", async () => {
      const room = await colyseus.createRoom<MyRoomState>("my_room", {});
      (room as any).random = () => 0; // first joiner becomes the Ghost
      const [first] = await connectPlayers(room, 1);
      const sleeper = room.state.players.get(first.sessionId);

      const bed = getRoomBedPixel(ROOM_POSITIONS[0]);
      sleeper.x = bed.x;
      sleeper.y = bed.y;
      first.send("toggleSleep");
      await room.waitForNextMessage();
      assert.strictEqual(room.state.doorsLocked[0], true);

      await connectPlayers(room, 4);

      assert.strictEqual(sleeper.role, "ghost");
      assert.strictEqual(sleeper.sleeping, false);
      assert.strictEqual(room.state.doorsLocked[0], false);
      assert.deepStrictEqual({ x: sleeper.x, y: sleeper.y }, getSpawnPixel(GHOST_SPAWN_TILE));
    });
  });
});
