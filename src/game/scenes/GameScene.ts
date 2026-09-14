import Phaser from "phaser";
import { getStateCallbacks, type InputHandle, type Room } from "@colyseus/sdk";
import { Player } from "../entities/Player";
import { RemotePlayer } from "../entities/RemotePlayer";
import { Bed } from "../entities/Bed";
import { BuildTile } from "../entities/BuildTile";
import { Gun } from "../entities/Gun";
import { GameClient } from "../network/GameClient";

type TilePosition = { tileX: number; tileY: number };
type PixelPosition = { x: number; y: number };

export class GameScene extends Phaser.Scene {

    private gameClient!: GameClient;
    private room?: Room;
    private remotePlayers = new Map<string, RemotePlayer>();
    private moveInput?: InputHandle<{ moveX: number; moveY: number }>;
    private walls!: Phaser.Physics.Arcade.StaticGroup;
    private player!: Player;
    private beds: Bed[] = [];
    private interactText!: Phaser.GameObjects.Text;

    private buildTiles: BuildTile[] = [];
    private guns: Gun[] = [];

    // There is one shared doorOpen state (see MyRoomState), rendered
    // identically across all four rooms' doors — standing near any one of
    // them toggles all four together. Per-room door state is deferred.
    private doorIsOpen = false;
    private doorBodies: Phaser.Physics.Arcade.StaticBody[] = [];
    private doorGraphics: Phaser.GameObjects.Graphics[] = [];
    private doorPositions: PixelPosition[] = [];

    private isSleeping = false;
    private coins = 0;
    private coinAccumulator = 0;

    private coinsText!: Phaser.GameObjects.Text;
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

        this.gameClient = new GameClient();

        this.gameClient.connect()
            .then((room) => {
                console.log("Doorbell connected!");
                console.log("My session:", room.sessionId);

                this.room = room;

                // The server already knows MoveInput's shape (MyRoom calls
                // defineInput(MoveInput)) and sends it during the join
                // handshake, so no schema import is needed on this side.
                this.moveInput = room.input();

                const $ = getStateCallbacks(room);

                // The server owns doorOpen — this only reacts to it. `true`
                // (immediate) applies the current value right away, so a
                // client joining an already-open room renders correctly
                // without waiting for the next toggle.
                $(room.state).listen("doorOpen", (doorOpen) => {
                    if (doorOpen) {
                        this.openDoor();
                    } else {
                        this.closeDoor();
                    }
                }, true);

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
                });

                $(room.state).players.onRemove((_remotePlayerState, sessionId) => {
                    this.remotePlayers.get(sessionId)?.destroy();
                    this.remotePlayers.delete(sessionId);
                });
            })
            .catch((error) => {
                console.error("Could not connect to Colyseus:", error);
            });

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

        this.input.keyboard!.on("keydown-E", () => {

            if (this.isSleeping) {
                return;
            }

            // Door gets priority
            if (this.isPlayerNearDoor()) {
                this.toggleDoor();
                return;
            }

            // Otherwise check bed
            if (this.isPlayerNearBed()) {
                this.toggleSleeping();
            }
        });

        this.input.keyboard!.on("keydown-ESC", () => {
            this.closeBuildMenu();
        });
    }

    update(_time: number, delta: number) {
        // If the player is sleeping,
        // don't allow movement.
        if (this.isSleeping) {
            // Accumulate the time that has passed
            this.coinAccumulator += delta;

            // 1000 milliseconds = 1 second
            if (this.coinAccumulator >= 1000) {
                this.coins += 1;

                this.coinsText.setText(
                    `COINS  ${this.coins}`
                );

                this.coinAccumulator -= 1000;
            }
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
                this.doorIsOpen
                    ? "E  CLOSE DOOR"
                    : "E  OPEN DOOR"
            );

            this.interactText.setPosition(
                nearbyDoor.x - 60,
                nearbyDoor.y - 55
            );

            return;
        }

        const nearbyBed = this.getNearbyBed();

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

    // Draws all four rooms from the shared roomPositions layout.
    private createFourRooms() {
        this.roomPositions.forEach((room) => {
            this.createRoomShell(room);
        });
    }

    // Draws one identical room: floor grid, tile-based wall ring with a
    // door gap in the bottom row, one bed, and build tiles across the
    // interior. Walls themselves are visual only — no physics bodies
    // (Milestone 6B is where room-wall collision returns); the door alone
    // keeps a physics body, purely for its own open/close toggle, exactly
    // like the original single room.
    private createRoomShell(room: TilePosition) {
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

        // Build tiles across the interior, minus the bed's own tile.
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
                    (clickedTile) => {
                        this.openBuildMenu(clickedTile);
                    }
                );

                this.buildTiles.push(tile);
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

    private drawDoorVisual(graphics: Phaser.GameObjects.Graphics, position: PixelPosition, isOpen: boolean) {
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

            graphics.lineStyle(2, 0xc8a96b, 1);
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

    private getNearbyDoor(): PixelPosition | undefined {
        return this.doorPositions.find((position) =>
            Phaser.Math.Distance.Between(this.player.x, this.player.y, position.x, position.y) < 75
        );
    }

    private isPlayerNearDoor(): boolean {
        return this.getNearbyDoor() !== undefined;
    }

    // Requests a toggle — does NOT flip doorIsOpen itself. The server
    // validates proximity against its own authoritative player position and
    // decides; openDoor()/closeDoor() only run once that decision comes
    // back through the doorOpen state listener above.
    private toggleDoor() {
        this.room?.send("toggleDoor");
    }

    private openDoor() {
        this.doorIsOpen = true;

        this.doorBodies.forEach((body) => {
            body.enable = false;
        });

        this.doorGraphics.forEach((graphics, index) => {
            this.drawDoorVisual(graphics, this.doorPositions[index], true);
        });
    }

    private closeDoor() {
        this.doorIsOpen = false;

        this.doorBodies.forEach((body) => {
            body.enable = true;
        });

        this.doorGraphics.forEach((graphics, index) => {
            this.drawDoorVisual(graphics, this.doorPositions[index], false);
        });
    }

    private toggleSleeping() {
        this.isSleeping = !this.isSleeping;

        if (this.isSleeping) {
            this.startSleeping();
        } else {
            this.stopSleeping();
        }
    }

    private startSleeping() {
        const bed = this.getNearbyBed();

        if (!bed) {
            return;
        }

        this.isSleeping = true;

        this.buildTiles.forEach((tile) => {
            tile.setBuildMode(true);
        });

        // Move the player to the center of the bed
        this.player.setPosition(
            bed.x,
            bed.y
        );

        // Stop all movement
        const body = this.player.body as Phaser.Physics.Arcade.Body;
        body.setVelocity(0, 0);

        // Hide interaction prompt
        this.interactText.setVisible(false);

        // Show sleeping state
        this.sleepingText.setVisible(true);

        this.sleepingText.setPosition(
            bed.x - 45,
            bed.y + 90
        );
    }

    private stopSleeping() {
        this.isSleeping = false;

        this.buildTiles.forEach((tile) => {
            tile.setBuildMode(false);
        });

        this.sleepingText.setVisible(false);

        const body = this.player.body as Phaser.Physics.Arcade.Body;
        body.setVelocity(0, 0);

        this.coinAccumulator = 0;
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

            this.buildGun(tile);

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

    private buildGun(tile: BuildTile) {
        const gunCost = 50;

        // --------------------------------
        // Check if we have enough coins
        // --------------------------------

        if (this.coins < gunCost) {
            console.log("Not enough coins");
            return;
        }

        // --------------------------------
        // Spend coins
        // --------------------------------

        this.coins -= gunCost;

        this.coinsText.setText(
            `COINS  ${this.coins}`
        );

        // --------------------------------
        // Occupy the tile
        // --------------------------------

        tile.setOccupied(true);

        // --------------------------------
        // Create gun on the tile
        // --------------------------------

        const gun = new Gun(
            this,
            tile.x,
            tile.y
        );

        this.guns.push(gun);

        // --------------------------------
        // Close build menu
        // --------------------------------

        this.closeBuildMenu();

        console.log("Gun built!");
    }

}
