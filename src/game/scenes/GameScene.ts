import Phaser from "phaser";
import { getStateCallbacks, type InputHandle, type Room } from "@colyseus/sdk";
import { Player } from "../entities/Player";
import { RemotePlayer, GHOST_TINT, GHOST_ALPHA } from "../entities/RemotePlayer";
import { Bed } from "../entities/Bed";
import { BuildTile } from "../entities/BuildTile";
import { Gun } from "../entities/Gun";

type TilePosition = { tileX: number; tileY: number };
type PixelPosition = { x: number; y: number };

/** Registry key under which createGame() hands this scene the joined room. */
export const ROOM_REGISTRY_KEY = "room";

export class GameScene extends Phaser.Scene {

    private room?: Room;
    private remotePlayers = new Map<string, RemotePlayer>();
    private moveInput?: InputHandle<{ moveX: number; moveY: number }>;
    private walls!: Phaser.Physics.Arcade.StaticGroup;
    private player!: Player;
    private beds: Bed[] = [];
    private interactText!: Phaser.GameObjects.Text;

    private buildTiles: BuildTile[] = [];
    // Flat lookup by the same global index the server uses
    // (roomIndex * buildTilesPerRoom + tileIndex) — see MyRoomState.buildTilesOccupied.
    private buildTilesByGlobalIndex: BuildTile[] = [];
    // Visuals for MyRoomState.guns, keyed by the server's gun id.
    private gunsById = new Map<string, Gun>();

    // Authoritative room the local player currently occupies, mirrored
    // from the server exactly like `isSleeping` below — build indicators
    // are computed from this + isSleeping, never decided locally.
    private localRoomIndex = -1;

    // Cache of each room's synchronized door state, indexed exactly like
    // MyRoomState.doorsOpen / server ROOM_POSITIONS / this.roomPositions.
    private doorsOpen: boolean[] = [];
    // Parallel to doorsOpen — true while that room's sleeping defender has
    // it locked (see MyRoomState.doorsLocked).
    private doorsLocked: boolean[] = [];
    private doorBodies: Phaser.Physics.Arcade.StaticBody[] = [];
    private doorGraphics: Phaser.GameObjects.Graphics[] = [];
    private doorPositions: PixelPosition[] = [];

    private isSleeping = false;

    // Mirrors the synced Player.role — public, never decided client-side.
    private isLocalGhost = false;
    private ghostSessionId = "";
    private ghostLabel!: Phaser.GameObjects.Text;

    // Free-look camera panning, enabled only while sleeping (see
    // applySleepingState()). Client-side only — never synchronized, and
    // never moves the player itself.
    private isDraggingCamera = false;

    private coinsText!: Phaser.GameObjects.Text;
    private phaseText!: Phaser.GameObjects.Text;
    private sleepingText!: Phaser.GameObjects.Text;
    private buildMenu?: Phaser.GameObjects.Container;

    // ============================================================
    // Tile geometry — mirrors server/src/shared/constants.ts exactly.
    // The frontend and server projects aren't linked as a shared package,
    // so this is a deliberate duplication; keep both in sync.
    // ============================================================

    private readonly tileSize = 60;

    private readonly arenaColumns = 32;
    private readonly arenaRows = 24;

    private readonly roomWidthTiles = 10;
    private readonly roomHeightTiles = 7;
    private readonly roomDoorColumn = 5;
    private readonly roomBedTile = { column: 5, row: 2 };

    // Top-left tile of each of the four rooms — solved so both axes divide
    // the playable interior exactly, with a 4-tile gap between neighboring
    // rooms and symmetric margins to the boundary ring (2 tiles vertically,
    // 3 horizontally; see the matching comment in constants.ts).
    private readonly roomPositions: ReadonlyArray<TilePosition> = [
        { tileX: 4, tileY: 3 },   // Room 1: top-left
        { tileX: 18, tileY: 3 },  // Room 2: top-right
        { tileX: 4, tileY: 14 },  // Room 3: bottom-left
        { tileX: 18, tileY: 14 }, // Room 4: bottom-right
    ];

    constructor() {
        super({ key: "GameScene" });
    }

    create() {

        this.walls = this.physics.add.staticGroup();

        this.createArenaBoundary();
        this.createPlayerTexture();
        this.createFourRooms();

        // Placeholder pre-connection position — the arena's own center,
        // same tile the four spawn slots cluster around server-side.
        this.player = new Player(
            this,
            this.arenaColumns * this.tileSize / 2,
            this.arenaRows * this.tileSize / 2
        );

        this.physics.add.collider(this.player, this.walls);

        // The arena is intentionally larger than the viewport — the camera
        // follows the local player and scrolls within the full world
        // instead of showing the whole map at once.
        this.cameras.main.setBounds(
            0,
            0,
            this.arenaColumns * this.tileSize,
            this.arenaRows * this.tileSize
        );
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

        // Fixed screen-space HUD — scrollFactor(0) so these stay put in the
        // corner as the camera follows the player around the larger arena,
        // instead of scrolling away with the world.
        this.add.text(40, 40, "DOORBELL", {
            fontFamily: "monospace",
            fontSize: 32,
            color: "#ffffff",
        }).setScrollFactor(0);
        this.coinsText = this.add.text(
            40,
            85,
            "COINS  0",
            {
                fontFamily: "monospace",
                fontSize: "20px",
                color: "#d6d6d6",
            }
        );
        this.coinsText.setScrollFactor(0);

        this.phaseText = this.add.text(40, 115, "", {
            fontFamily: "monospace",
            fontSize: "18px",
            color: "#8fd8ff",
        });
        this.phaseText.setScrollFactor(0);

        this.interactText = this.add.text(
            0,
            0,
            "E  SLEEP",
            {
                fontFamily: "monospace",
                fontSize: "16px",
                color: "#ffffff",
                backgroundColor: "#111111",
                padding: {
                x: 8,
                y: 6,
                },
            }
        );

        this.interactText.setVisible(false);

        this.sleepingText = this.add.text(
        0,
        0,
        "SLEEPING",
        {
            fontFamily: "monospace",
            fontSize: "16px",
            color: "#c8a96b",
            backgroundColor: "#111111",
            padding: {
            x: 8,
            y: 6,
            },
        }
        );

        this.sleepingText.setVisible(false);

        this.ghostLabel = this.add.text(0, 0, "GHOST", {
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#8fd8ff",
        });
        this.ghostLabel.setOrigin(0.5, 1);
        this.ghostLabel.setVisible(false);

        this.input.keyboard!.on("keydown-E", () => {

            // Already sleeping: E only ever wakes up — no door interaction
            // while asleep. `isSleeping` here mirrors the server's
            // authoritative `sleeping`; the actual transition still has to
            // round-trip through the server (see toggleSleeping()).
            if (this.isSleeping) {
                this.toggleSleeping();
                return;
            }

            // Door gets priority
            if (this.isPlayerNearDoor()) {
                this.toggleDoor();
                return;
            }

            // Otherwise check bed (the server rejects Ghost sleep regardless)
            if (!this.isLocalGhost && this.isPlayerNearBed()) {
                this.toggleSleeping();
            }
        });

        this.input.keyboard!.on("keydown-ESC", () => {
            this.closeBuildMenu();
        });

        this.setupCameraDrag();

        // Last: the immediate state callbacks below touch the player and
        // HUD objects created above.
        this.bindRoom(this.registry.get(ROOM_REGISTRY_KEY) as Room);
    }

    // The room was already joined in the lobby — same session, no reconnect.
    private bindRoom(room: Room) {
        console.log("Doorbell connected!");
        console.log("My session:", room.sessionId);

        this.room = room;

        // The server already knows MoveInput's shape (MyRoom calls
        // defineInput(MoveInput)) and sends it during the join
        // handshake, so no schema import is needed on this side.
        this.moveInput = room.input();

        const $ = getStateCallbacks(room);

        // Display only: the server alone decides when preparation ends.
        $(room.state).listen("phase", () => this.updatePhaseText(), true);
        $(room.state).listen("preparationSecondsLeft", () => this.updatePhaseText(), true);

        // The server owns doorsOpen — this only reacts to it. onAdd
        // fires once per existing entry immediately on subscribe
        // (all 4, already pushed server-side before any client can
        // join), so a client joining mid-game renders every room's
        // current state right away, not just future toggles.
        $(room.state).doorsOpen.onAdd((isOpen: boolean, roomIndex: number) => {
            this.setDoorVisual(roomIndex, isOpen);
        }, true);

        $(room.state).doorsOpen.onChange((isOpen: boolean, roomIndex: number) => {
            this.setDoorVisual(roomIndex, isOpen);
        });

        // Same pattern as doorsOpen above, kept as its own parallel
        // array/listener rather than folded into setDoorVisual —
        // open/closed and locked/unlocked can each change on their
        // own (e.g. waking unlocks without opening the door).
        $(room.state).doorsLocked.onAdd((isLocked: boolean, roomIndex: number) => {
            this.setDoorLockVisual(roomIndex, isLocked);
        }, true);

        $(room.state).doorsLocked.onChange((isLocked: boolean, roomIndex: number) => {
            this.setDoorLockVisual(roomIndex, isLocked);
        });

        // The server owns occupancy for every build-tile slot
        // across all four rooms, keyed by the same global index
        // BuildTile uses (see buildTilesByGlobalIndex). This only
        // drives the tiles' own "+" state; guns render from
        // state.guns below.
        $(room.state).buildTilesOccupied.onAdd((isOccupied: boolean, globalIndex: number) => {
            this.setBuildTileOccupied(globalIndex, isOccupied);
        }, true);

        $(room.state).buildTilesOccupied.onChange((isOccupied: boolean, globalIndex: number) => {
            this.setBuildTileOccupied(globalIndex, isOccupied);
        });

        // Every gun is public: all clients render every entry at
        // the server-decided x/y, regardless of whose room it's in.
        $(room.state).guns.onAdd((gunState, gunId: string) => {
            if (this.gunsById.has(gunId)) { return; }
            this.gunsById.set(gunId, new Gun(this, gunState.x, gunState.y));
        }, true);

        $(room.state).guns.onRemove((_gunState, gunId: string) => {
            this.gunsById.get(gunId)?.destroy();
            this.gunsById.delete(gunId);
        });

        $(room.state).players.onAdd((remotePlayerState, sessionId) => {
            // The server also creates a state entry for us. The local
            // player is already represented by the keyboard-reading
            // `Player` instance — just keep its position in sync with
            // the authoritative state instead of spawning a RemotePlayer.
            if (sessionId === room.sessionId) {
                $(remotePlayerState).onChange(() => {
                    this.player.applyServerPosition(
                        remotePlayerState.x,
                        remotePlayerState.y
                    );
                });

                // The server owns sleeping — this only reacts to
                // it. `true` (immediate) applies the current value
                // right away for a client joining mid-sleep.
                $(remotePlayerState).listen("sleeping", (isSleeping: boolean) => {
                    this.applySleepingState(isSleeping);
                }, true);

                // The server owns room membership too — build
                // indicators are gated on this + sleeping together
                // (see updateBuildVisibility()).
                $(remotePlayerState).listen("roomIndex", (roomIndex: number) => {
                    this.localRoomIndex = roomIndex;
                    this.updateBuildVisibility();
                }, true);

                // The server owns the coin balance — this label is
                // purely a reflection of it, never a local count.
                $(remotePlayerState).listen("coins", (coins: number) => {
                    this.coinsText.setText(`COINS  ${coins}`);
                }, true);

                $(remotePlayerState).listen("role", (role: string) => {
                    this.isLocalGhost = role === "ghost";
                    if (this.isLocalGhost) {
                        this.player.setTint(GHOST_TINT);
                        this.player.setAlpha(GHOST_ALPHA);
                    }
                    this.setGhostSession(sessionId, role);
                }, true);

                return;
            }

            const remotePlayer = new RemotePlayer(
                this,
                remotePlayerState.x,
                remotePlayerState.y
            );

            this.remotePlayers.set(sessionId, remotePlayer);

            $(remotePlayerState).onChange(() => {
                remotePlayer.setPosition(
                    remotePlayerState.x,
                    remotePlayerState.y
                );
            });

            $(remotePlayerState).listen("sleeping", (isSleeping: boolean) => {
                remotePlayer.setSleeping(isSleeping);
            }, true);

            $(remotePlayerState).listen("role", (role: string) => {
                remotePlayer.setRole(role);
                this.setGhostSession(sessionId, role);
            }, true);
        });

        $(room.state).players.onRemove((_remotePlayerState, sessionId) => {
            this.remotePlayers.get(sessionId)?.destroy();
            this.remotePlayers.delete(sessionId);
            if (this.ghostSessionId === sessionId) {
                this.ghostSessionId = "";
            }
        });
    }

    // Free-look panning for a sleeping defender — the player stays locked
    // to the bed (movement is already disabled server- and client-side
    // while sleeping); only the camera moves, and only client-side.
    // Phaser's generic pointer events (not a game-object's own
    // "pointerdown") so this works the same for mouse and touch.
    private setupCameraDrag() {
        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (!this.isSleeping) { return; }

            // Let clicks on build tiles / the build menu / any other
            // interactive UI reach their own handlers instead of starting
            // a drag — only bare map space begins a pan.
            if (this.input.hitTestPointer(pointer).length > 0) { return; }

            this.isDraggingCamera = true;
        });

        this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
            if (!this.isDraggingCamera || !pointer.isDown) { return; }

            const camera = this.cameras.main;

            // Dragging right reveals the world's left side — the camera
            // moves opposite the drag, like grabbing and pulling the map.
            // Phaser's bounds system (setBounds() above) clamps this
            // automatically every frame; no manual clamping needed here.
            camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
            camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
        });

        this.input.on("pointerup", () => {
            this.isDraggingCamera = false;
        });
    }

    update(_time: number, _delta: number) {
        this.updateGhostLabel();

        // If the player is sleeping (server-authoritative — see
        // applySleepingState()), don't allow movement.
        if (this.isSleeping) {
            // Coins are now earned server-side (see the "coins" listener
            // in create()) — this branch only re-anchors the label.

            // Re-anchored every frame (rather than once, on the sleeping
            // transition) so it can't show stale if the position sync and
            // the sleeping-state sync land in different network patches.
            this.sleepingText.setPosition(
                this.player.x - 45,
                this.player.y + 90
            );

            // Don't process movement while sleeping
            return;
        }

        // Player is awake: read keyboard intent and send it to the server.
        // The server is authoritative — this does not move the sprite
        // locally; the reactive onChange handler above does that once the
        // resulting state patch comes back.
        this.player.update();

        if (this.moveInput) {
            const { moveX, moveY } = this.player.getInput();

            this.moveInput.data.moveX = moveX;
            this.moveInput.data.moveY = moveY;

            this.moveInput.send();
        }

        const nearbyDoor = this.getNearbyDoor();

        if (nearbyDoor) {

            this.interactText.setVisible(true);

            this.interactText.setText(
                this.doorsLocked[nearbyDoor.roomIndex]
                    ? "LOCKED"
                    : this.doorsOpen[nearbyDoor.roomIndex]
                        ? "E  CLOSE DOOR"
                        : "E  OPEN DOOR"
            );

            this.interactText.setPosition(
                nearbyDoor.position.x - 60,
                nearbyDoor.position.y - 55
            );

            return;
        }

        const nearbyBed = this.isLocalGhost ? undefined : this.getNearbyBed();

        if (nearbyBed) {

            this.interactText.setVisible(true);

            this.interactText.setText(
                "E  SLEEP"
            );

            this.interactText.setPosition(
                nearbyBed.x - 40,
                nearbyBed.y + 90
            );

            return;
        }

        this.interactText.setVisible(false);
    }

    // ============================================================
    // Tile -> pixel geometry helpers (mirrors the server's functions of
    // the same shape in constants.ts).
    // ============================================================

    private tileToPixel(tileX: number, tileY: number): PixelPosition {
        return { x: tileX * this.tileSize, y: tileY * this.tileSize };
    }

    private getRoomDoorPixel(room: TilePosition): PixelPosition {
        const origin = this.tileToPixel(room.tileX, room.tileY);
        return {
            x: origin.x + this.roomDoorColumn * this.tileSize + this.tileSize / 2,
            y: origin.y + (this.roomHeightTiles - 1) * this.tileSize + this.tileSize / 2,
        };
    }

    private getRoomBedPixel(room: TilePosition): PixelPosition {
        const origin = this.tileToPixel(room.tileX, room.tileY);
        return {
            x: origin.x + this.roomBedTile.column * this.tileSize + this.tileSize / 2,
            y: origin.y + this.roomBedTile.row * this.tileSize + this.tileSize / 2,
        };
    }

    // One wall tile's visual — reused by both the arena boundary ring and
    // every room's wall ring, so the two stay visually identical.
    private drawWallTile(graphics: Phaser.GameObjects.Graphics, tileX: number, tileY: number) {
        const x = tileX * this.tileSize;
        const y = tileY * this.tileSize;

        graphics.fillStyle(0x181818, 1);
        graphics.fillRect(x, y, this.tileSize, this.tileSize);

        graphics.lineStyle(1, 0x3f3f3f, 1);
        graphics.strokeRect(x, y, this.tileSize, this.tileSize);
    }

    // The arena's own outer tile ring (column 0/23, row 0/17) — the same
    // "outer ring = boundary" pattern as each room, one scale up. This is
    // visual only; the server enforces the matching pixel rectangle
    // (ARENA_LEFT/TOP/RIGHT/BOTTOM in movement.ts) independently.
    private createArenaBoundary() {
        const graphics = this.add.graphics();

        for (let x = 0; x < this.arenaColumns; x++) {
            this.drawWallTile(graphics, x, 0);
            this.drawWallTile(graphics, x, this.arenaRows - 1);
        }

        for (let y = 1; y < this.arenaRows - 1; y++) {
            this.drawWallTile(graphics, 0, y);
            this.drawWallTile(graphics, this.arenaColumns - 1, y);
        }
    }

    // Number of build-tile slots per room (8x5 interior minus the bed
    // tile) — mirrors server/src/shared/constants.ts's
    // ROOM_BUILD_TILES.length exactly; both are derived from the same
    // roomWidthTiles/roomHeightTiles/roomBedTile shape.
    private readonly buildTilesPerRoom =
        (this.roomHeightTiles - 2) * (this.roomWidthTiles - 2) - 1;

    // Draws all four rooms from the shared roomPositions layout.
    private createFourRooms() {
        this.roomPositions.forEach((room, roomIndex) => {
            this.createRoomShell(room, roomIndex);
        });
    }

    // Draws one identical room: floor grid, tile-based wall ring with a
    // door gap in the bottom row, one bed, and build tiles across the
    // interior. Walls themselves are visual only — no physics bodies
    // (Milestone 6B is where room-wall collision returns); the door alone
    // keeps a physics body, purely for its own open/close toggle, exactly
    // like the original single room.
    private createRoomShell(room: TilePosition, roomIndex: number) {
        const graphics = this.add.graphics();

        // Floor grid across the room's full span — walls are painted over
        // the outer ring below, same layering the original room used.
        graphics.lineStyle(1, 0x3a3a3a, 1);

        for (let row = 0; row < this.roomHeightTiles; row++) {
            for (let column = 0; column < this.roomWidthTiles; column++) {
                const x = (room.tileX + column) * this.tileSize;
                const y = (room.tileY + row) * this.tileSize;

                graphics.strokeRect(x, y, this.tileSize, this.tileSize);
            }
        }

        // Top row + bottom row (door tile skipped on the bottom row).
        for (let column = 0; column < this.roomWidthTiles; column++) {
            this.drawWallTile(graphics, room.tileX + column, room.tileY);

            if (column === this.roomDoorColumn) {
                this.createDoor(room);
            } else {
                this.drawWallTile(
                    graphics,
                    room.tileX + column,
                    room.tileY + this.roomHeightTiles - 1
                );
            }
        }

        // Left/right columns — interior rows only, corners already drawn above.
        for (let row = 1; row < this.roomHeightTiles - 1; row++) {
            this.drawWallTile(graphics, room.tileX, room.tileY + row);
            this.drawWallTile(graphics, room.tileX + this.roomWidthTiles - 1, room.tileY + row);
        }

        // Bed
        const bedPixel = this.getRoomBedPixel(room);
        this.beds.push(new Bed(this, bedPixel.x, bedPixel.y));

        // Build tiles across the interior, minus the bed's own tile. The
        // row-major order here (row outer, column inner, bed tile skipped)
        // IS the tileIndex sequence — it must match
        // server/src/shared/constants.ts's ROOM_BUILD_TILES exactly, since
        // a "build" request names a tile only by this index.
        let tileIndex = 0;

        for (let row = 1; row < this.roomHeightTiles - 1; row++) {
            for (let column = 1; column < this.roomWidthTiles - 1; column++) {

                if (column === this.roomBedTile.column && row === this.roomBedTile.row) {
                    continue;
                }

                const x = (room.tileX + column) * this.tileSize + this.tileSize / 2;
                const y = (room.tileY + row) * this.tileSize + this.tileSize / 2;

                const tile = new BuildTile(
                    this,
                    x,
                    y,
                    this.tileSize,
                    roomIndex,
                    tileIndex,
                    (clickedTile) => {
                        this.openBuildMenu(clickedTile);
                    }
                );

                this.buildTiles.push(tile);
                this.buildTilesByGlobalIndex[roomIndex * this.buildTilesPerRoom + tileIndex] = tile;

                tileIndex++;
            }
        }
    }

    private createDoor(room: TilePosition) {
        const doorGraphics = this.add.graphics();
        const doorPixel = this.getRoomDoorPixel(room);

        this.drawDoorVisual(doorGraphics, doorPixel, false);

        const doorRect = this.add.rectangle(
            doorPixel.x,
            doorPixel.y,
            this.tileSize,
            this.tileSize
        );

        this.physics.add.existing(doorRect, true);
        this.walls.add(doorRect);

        this.doorGraphics.push(doorGraphics);
        this.doorPositions.push(doorPixel);
        this.doorBodies.push(doorRect.body as Phaser.Physics.Arcade.StaticBody);
    }

    private drawDoorVisual(graphics: Phaser.GameObjects.Graphics, position: PixelPosition, isOpen: boolean, isLocked: boolean = false) {
        graphics.clear();

        const half = this.tileSize / 2;

        if (isOpen) {
            graphics.fillStyle(0x101010, 1);
            graphics.fillRect(position.x - half, position.y - half, this.tileSize, this.tileSize);

            graphics.lineStyle(1, 0x3a3a3a, 1);
            graphics.strokeRect(position.x - half + 4, position.y - half + 4, this.tileSize - 8, this.tileSize - 8);
        } else {
            graphics.fillStyle(0x151515, 1);
            graphics.fillRect(position.x - half, position.y - half, this.tileSize, this.tileSize);

            // Closed + locked reuses the same closed-door shape, just with
            // a red outline instead of gold — a minimal indicator, not a
            // redesign of the door artwork.
            graphics.lineStyle(2, isLocked ? 0xd64545 : 0xc8a96b, 1);
            graphics.strokeRect(position.x - half + 3, position.y - half + 3, this.tileSize - 6, this.tileSize - 6);
        }
    }

    private createPlayerTexture() {
        const graphics = this.add.graphics();

        // Body
        graphics.fillStyle(0xd6d6d6, 1);
        graphics.fillCircle(16, 16, 12);

        // Outline
        graphics.lineStyle(2, 0xffffff, 1);
        graphics.strokeCircle(16, 16, 12);

        // Small direction indicator
        graphics.fillStyle(0x555555, 1);
        graphics.fillTriangle(
            16, 4,
            11, 12,
            21, 12
        );

        graphics.generateTexture("player", 32, 32);

        graphics.destroy();
    }

    private getNearbyBed(): Bed | undefined {
        return this.beds.find((bed) =>
            Phaser.Math.Distance.Between(this.player.x, this.player.y, bed.x, bed.y) < 45
        );
    }

    private isPlayerNearBed(): boolean {
        return this.getNearbyBed() !== undefined;
    }

    private getNearbyDoor(): { roomIndex: number; position: PixelPosition } | undefined {
        for (let roomIndex = 0; roomIndex < this.doorPositions.length; roomIndex++) {
            const position = this.doorPositions[roomIndex];

            if (Phaser.Math.Distance.Between(this.player.x, this.player.y, position.x, position.y) < 75) {
                return { roomIndex, position };
            }
        }

        return undefined;
    }

    private isPlayerNearDoor(): boolean {
        return this.getNearbyDoor() !== undefined;
    }

    // Requests a toggle for the nearest door's room — does NOT flip
    // doorsOpen itself. The server validates proximity (against its own
    // authoritative player position, never a client-supplied one) and
    // decides; setDoorVisual() only runs once that decision comes back
    // through the doorsOpen state listener above.
    private toggleDoor() {
        const nearbyDoor = this.getNearbyDoor();

        if (!nearbyDoor) {
            return;
        }

        this.room?.send("toggleDoor", { roomIndex: nearbyDoor.roomIndex });
    }

    private setDoorVisual(roomIndex: number, isOpen: boolean) {
        this.doorsOpen[roomIndex] = isOpen;
        this.redrawDoor(roomIndex);
    }

    // Reacts to the server's authoritative buildTilesOccupied flag for one
    // global tile index — never set locally by a click.
    private setBuildTileOccupied(globalIndex: number, isOccupied: boolean) {
        this.buildTilesByGlobalIndex[globalIndex]?.setOccupied(isOccupied);
        this.updateBuildVisibility();
    }

    private setDoorLockVisual(roomIndex: number, isLocked: boolean) {
        this.doorsLocked[roomIndex] = isLocked;
        this.redrawDoor(roomIndex);
    }

    private redrawDoor(roomIndex: number) {
        const body = this.doorBodies[roomIndex];
        const graphics = this.doorGraphics[roomIndex];
        const position = this.doorPositions[roomIndex];

        if (!body || !graphics || !position) {
            return;
        }

        const isOpen = this.doorsOpen[roomIndex] ?? false;
        const isLocked = this.doorsLocked[roomIndex] ?? false;

        body.enable = !isOpen;
        this.drawDoorVisual(graphics, position, isOpen, isLocked);
    }

    private updatePhaseText() {
        const state = this.room?.state;
        if (!state) { return; }

        if (state.phase === "preparation") {
            this.phaseText.setText(`PREPARATION  ${state.preparationSecondsLeft}`);
        } else if (state.phase === "active") {
            this.phaseText.setText("ACTIVE");
        } else {
            this.phaseText.setText("");
        }
    }

    private setGhostSession(sessionId: string, role: string) {
        if (role === "ghost") {
            this.ghostSessionId = sessionId;
        } else if (this.ghostSessionId === sessionId) {
            this.ghostSessionId = "";
        }
    }

    // Before update()'s sleeping early-return, so the label keeps tracking
    // the Ghost for a sleeping defender too.
    private updateGhostLabel() {
        const sprite = this.ghostSessionId === this.room?.sessionId
            ? this.player
            : this.remotePlayers.get(this.ghostSessionId);

        if (!this.ghostSessionId || !sprite) {
            this.ghostLabel.setVisible(false);
            return;
        }

        this.ghostLabel.setVisible(true);
        this.ghostLabel.setPosition(sprite.x, sprite.y - 20);
    }

    // Requests a sleep/wake toggle — does NOT flip isSleeping itself. The
    // server derives room + bed from the player's own authoritative
    // position, validates proximity and room occupancy, and decides;
    // applySleepingState() only runs once that decision comes back through
    // the "sleeping" state listener above. No payload: the server already
    // knows the player's position, and waking needs no location at all.
    private toggleSleeping() {
        this.room?.send("toggleSleep");
    }

    // Reacts to the server's authoritative `sleeping` value — for both the
    // local player and (via a symmetric listener above) every remote one.
    // Position itself is handled generically by the existing per-player
    // onChange -> applyServerPosition/setPosition pipeline, since the
    // server snaps x/y to the bed as part of the same state change.
    private applySleepingState(isSleeping: boolean) {
        this.isSleeping = isSleeping;

        this.updateBuildVisibility();

        this.sleepingText.setVisible(isSleeping);

        if (isSleeping) {
            // Stop following where the camera already is — the sleeping
            // defender starts looking around from whatever's currently on
            // screen, not a re-centered view.
            this.cameras.main.stopFollow();

            this.interactText.setVisible(false);
            // Best-effort immediate placement; update() re-anchors this
            // every frame afterward regardless.
            this.sleepingText.setPosition(
                this.player.x - 45,
                this.player.y + 90
            );
        } else {
            // Waking: drop any in-progress pan and resume the normal
            // awake follow behavior exactly as it was originally set up.
            this.isDraggingCamera = false;
            this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        }
    }

    // Recomputes every build tile's "+" visibility from the two
    // authoritative values that gate it: the local player must be
    // sleeping, and the tile must belong to the room they're sleeping in.
    // Occupied tiles never show "+" regardless (BuildTile.setOccupied
    // already hides its own plus sign, but skip it here too for clarity).
    // Called whenever either authoritative value changes, or a tile's own
    // occupancy changes.
    private updateBuildVisibility() {
        this.buildTiles.forEach((tile) => {
            const shouldShow = this.isSleeping
                && tile.roomIndex === this.localRoomIndex
                && !tile.isOccupied;

            tile.setBuildMode(shouldShow);
        });
    }

    private openBuildMenu(tile: BuildTile) {

        // Remove existing menu
        if (this.buildMenu) {
            this.buildMenu.destroy();
        }

        this.buildMenu = this.add.container(
            tile.x,
            tile.y
        );

        // Menu background
        const background = this.add.rectangle(
            0,
            0,
            190,
            100,
            0x111111
        );

        background.setStrokeStyle(
            2,
            0x555555
        );

        // Title
        const title = this.add.text(
            0,
            -32,
            "BUILD",
            {
                fontFamily: "monospace",
                fontSize: "18px",
                color: "#ffffff",
            }
        );

        title.setOrigin(0.5);

        const closeButton = this.add.text(
            80,
            -32,
            "×",
            {
                fontFamily: "monospace",
                fontSize: "24px",
                color: "#888888",
            }
        );

        closeButton.setOrigin(0.5);

        closeButton.setInteractive({
            useHandCursor: true,
        });

        closeButton.on("pointerover", () => {
            closeButton.setColor("#ffffff");
        });

        closeButton.on("pointerout", () => {
            closeButton.setColor("#aaaaaa");
        });

        closeButton.on("pointerdown", () => {
            this.closeBuildMenu();
        });

        // Gun button
        const gunButton = this.add.text(
            0,
            15,
            "GUN       [50]",
            {
                fontFamily: "monospace",
                fontSize: "16px",
                color: "#ffffff",
                backgroundColor: "#222222",
                padding: {
                    x: 10,
                    y: 8,
                },
            }
        );

        gunButton.setOrigin(0.5);

        gunButton.setInteractive({
            useHandCursor: true,
        });

        gunButton.on("pointerdown", () => {

            this.requestBuild(tile);

        });

        this.buildMenu.add([
            background,
            title,
            closeButton,
            gunButton,
        ]);
    }

    private closeBuildMenu() {
        this.buildMenu?.destroy();
        this.buildMenu = undefined;
    }

    // Sends a build request naming only the tile's index within its own
    // room — never a room index, a position, or a coin balance. The
    // server derives the room from the player's own authoritative
    // roomIndex and validates sleeping/occupancy/coins; the tile's
    // occupied visual and the Gun itself only ever appear once that
    // decision comes back through the buildTilesOccupied listener above.
    private requestBuild(tile: BuildTile) {
        this.room?.send("build", { tileIndex: tile.tileIndex });
        this.closeBuildMenu();
    }

}
