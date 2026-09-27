import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoomState, Gun, type MoveInput } from "../src/rooms/schema/MyRoomState.js";
import {
  PLAYER_SPEED, TICK_RATE, ROOM_POSITIONS, GUN_COST, BUILD_TILES_PER_ROOM,
  getRoomBedPixel, getRoomBuildTilePixel, GUN_RANGE, GUN_FIRE_RATE_MS,
} from "../src/shared/constants.js";
import { stepGunFiring, type FiringGun } from "../src/shared/gunFiring.js";

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

      await clientB.waitForNextPatch();
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
      await observer.waitForNextPatch();

      assert.strictEqual(observer.state.guns.get("gun-a")?.targetId, ghostClient.sessionId);
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

      await observer.waitForNextPatch();
      assert.strictEqual(observer.state.guns.get("gun-a")?.fireSequence, 1);
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
});
