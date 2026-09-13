import Phaser from "phaser";
import { Player } from "../entities/Player";
import { Bed } from "../entities/Bed";
import { BuildTile } from "../entities/BuildTile";
import { Gun } from "../entities/Gun";

export class GameScene extends Phaser.Scene {
    private walls!: Phaser.Physics.Arcade.StaticGroup;
    private player!: Player;
    private bed!: Bed;
    private interactText!: Phaser.GameObjects.Text;

    private buildTiles: BuildTile[] = [];
    private guns: Gun[] = [];

    private doorIsOpen = false;
    private doorBody!: Phaser.Physics.Arcade.StaticBody;
    private doorGraphics!: Phaser.GameObjects.Graphics;
    private doorX = 0;
    private doorY = 0;

    private isSleeping = false;
    private coins = 0;
    private coinAccumulator = 0;

    private coinsText!: Phaser.GameObjects.Text;
    private sleepingText!: Phaser.GameObjects.Text;
    private buildMenu?: Phaser.GameObjects.Container;

    private readonly tileSize = 60;
    private readonly roomX = 340;
    private readonly roomY = 140;
    private readonly columns = 10;
    private readonly rows = 7;

    constructor() {
        super({ key: "GameScene" });
    }

    create() {
        this.walls = this.physics.add.staticGroup();
        
        this.createPlayerTexture();
        this.createRoom();

        const bedColumn = 5;
        const bedRow = 2;

        const bedX =
            this.roomX +
            bedColumn * this.tileSize +
            this.tileSize / 2;

        const bedY =
            this.roomY +
            bedRow * this.tileSize +
            this.tileSize / 2;

        this.bed = new Bed(
            this,
            bedX,
            bedY
        );

        this.createBuildTiles();

        this.player = new Player(
            this, 
            640, 
            360
        );
        
        this.physics.add.collider(this.player, this.walls);

        this.add.text(40, 40, "DOORBELL", {
            fontFamily: "monospace",
            fontSize: 32,
            color: "#ffffff",
        });
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

        // Player is awake, so movement works normally.
        this.player.update();

        const nearDoor = this.isPlayerNearDoor();

        if (nearDoor) {

            this.interactText.setVisible(true);

            this.interactText.setText(
                this.doorIsOpen
                    ? "E  CLOSE DOOR"
                    : "E  OPEN DOOR"
            );

            this.interactText.setPosition(
                this.doorX - 60,
                this.doorY - 55
            );

            return;
        }

        const nearBed = this.isPlayerNearBed();

        if (nearBed) {

            this.interactText.setVisible(true);

            this.interactText.setText(
                "E  SLEEP"
            );

            this.interactText.setPosition(
                this.bed.x - 40,
                this.bed.y + 90
            );

            return;
        }

        this.interactText.setVisible(false);
    }

    private createRoom() {
        const graphics = this.add.graphics();

        const tileSize = this.tileSize;
        const roomX = this.roomX;
        const roomY = this.roomY;
     
        const roomWidth = this.columns * tileSize;
        const roomHeight = this.rows * tileSize;

        // The gate occupies exactly one tile.
        const gateColumn = 5;

        // =========================================================
        // FLOOR GRID
        // =========================================================

        graphics.lineStyle(
            1,
            0x3a3a3a,
            1
        );

        for (let row = 0; row < this.rows; row++) {
            for (let column = 0; column < this.columns; column++) {

                const x = roomX + column * tileSize;
                const y = roomY + row * tileSize;

                graphics.strokeRect(
                    x,
                    y,
                    tileSize,
                    tileSize
                );
            }
        }

        // =========================================================
        // WALL TILE COLORS
        // =========================================================

        const wallFill = 0x181818;
        const wallBorder = 0x3f3f3f;

        // =========================================================
        // TOP WALL
        // =========================================================

        for (let column = 0; column < this.columns; column++) {

            const x = roomX + column * tileSize;
            const y = roomY - tileSize;

            // Wall tile
            graphics.fillStyle(
                wallFill,
                1
            );

            graphics.fillRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Tile border
            graphics.lineStyle(
                1,
                wallBorder,
                1
            );

            graphics.strokeRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Physics
            const wall = this.add.rectangle(
                x + tileSize / 2,
                y + tileSize / 2,
                tileSize,
                tileSize
            );

            this.physics.add.existing(
                wall,
                true
            );

            this.walls.add(wall);
        }

        // =========================================================
        // LEFT WALL
        // =========================================================

        for (let row = 0; row < this.rows; row++) {

            const x = roomX - tileSize;
            const y = roomY + row * tileSize;

            // Wall tile
            graphics.fillStyle(
                wallFill,
                1
            );

            graphics.fillRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Tile border
            graphics.lineStyle(
                1,
                wallBorder,
                1
            );

            graphics.strokeRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Physics
            const wall = this.add.rectangle(
                x + tileSize / 2,
                y + tileSize / 2,
                tileSize,
                tileSize
            );

            this.physics.add.existing(
                wall,
                true
            );

            this.walls.add(wall);
        }

        // =========================================================
        // RIGHT WALL
        // =========================================================

        for (let row = 0; row < this.rows; row++) {

            const x = roomX + roomWidth;
            const y = roomY + row * tileSize;

            // Wall tile
            graphics.fillStyle(
                wallFill,
                1
            );

            graphics.fillRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Tile border
            graphics.lineStyle(
                1,
                wallBorder,
                1
            );

            graphics.strokeRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Physics
            const wall = this.add.rectangle(
                x + tileSize / 2,
                y + tileSize / 2,
                tileSize,
                tileSize
            );

            this.physics.add.existing(
                wall,
                true
            );

            this.walls.add(wall);
        }

        // =========================================================
        // BOTTOM WALL + GATE
        // =========================================================

        for (let column = 0; column < this.columns; column++) {

            const x = roomX + column * tileSize;
            const y = roomY + roomHeight;

            // =====================================================
            // GATE TILE
            // =====================================================

            if (column === gateColumn) {

                // =================================================
                // DOOR
                // =================================================

                this.doorX = x + tileSize / 2;
                this.doorY = y + tileSize / 2;

                this.doorGraphics = this.add.graphics();

                // Door tile visual
                this.doorGraphics.fillStyle(
                    0x151515,
                    1
                );

                this.doorGraphics.fillRect(
                    this.doorX - tileSize / 2,
                    this.doorY - tileSize / 2,
                    tileSize,
                    tileSize
                );

                // Door border
                this.doorGraphics.lineStyle(
                    2,
                    0xc8a96b,
                    1
                );

                this.doorGraphics.strokeRect(
                    this.doorX - tileSize / 2 + 3,
                    this.doorY - tileSize / 2 + 3,
                    tileSize - 6,
                    tileSize - 6
                );

                // =================================================
                // DOOR PHYSICS
                // =================================================

                const door = this.add.rectangle(
                    this.doorX,
                    this.doorY,
                    tileSize,
                    tileSize
                );

                this.physics.add.existing(
                    door,
                    true
                );

                this.doorBody =
                    door.body as Phaser.Physics.Arcade.StaticBody;

                this.walls.add(door);

                continue;
            }

            // =====================================================
            // NORMAL WALL TILE
            // =====================================================

            graphics.fillStyle(
                wallFill,
                1
            );

            graphics.fillRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Tile border
            graphics.lineStyle(
                1,
                wallBorder,
                1
            );

            graphics.strokeRect(
                x,
                y,
                tileSize,
                tileSize
            );

            // Physics
            const wall = this.add.rectangle(
                x + tileSize / 2,
                y + tileSize / 2,
                tileSize,
                tileSize
            );

            this.physics.add.existing(
                wall,
                true
            );

            this.walls.add(wall);
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

    private isPlayerNearBed(): boolean {
        const distance = Phaser.Math.Distance.Between(
            this.player.x,
            this.player.y,
            this.bed.x,
            this.bed.y  
        );

        return distance < 45;
    }

    private isPlayerNearDoor(): boolean {
        const distance = Phaser.Math.Distance.Between(
            this.player.x,
            this.player.y,
            this.doorX,
            this.doorY
        );

        return distance < 75;
    }

    private toggleDoor() {
        this.doorIsOpen = !this.doorIsOpen;

        if (this.doorIsOpen) {
            this.openDoor();
        } else {
            this.closeDoor();
        }
    }

    private openDoor() {
        this.doorIsOpen = true;

        // Disable collision
        this.doorBody.enable = false;

        // Remove the closed-door graphic
        this.doorGraphics.clear();

        // Draw an open doorway
        this.doorGraphics.fillStyle(
            0x101010,
            1
        );

        this.doorGraphics.fillRect(
            this.doorX - this.tileSize / 2,
            this.doorY - this.tileSize / 2,
            this.tileSize,
            this.tileSize
        );

        // Subtle opening border
        this.doorGraphics.lineStyle(
            1,
            0x3a3a3a,
            1
        );

        this.doorGraphics.strokeRect(
            this.doorX - this.tileSize / 2 + 4,
            this.doorY - this.tileSize / 2 + 4,
            this.tileSize - 8,
            this.tileSize - 8
        );
    }

    private toggleSleeping() {
        this.isSleeping = !this.isSleeping;

        if (this.isSleeping) {
            this.startSleeping();
        } else {
            this.stopSleeping();
        }
    }

    private closeDoor() {
        this.doorIsOpen = false;

        // Enable collision
        this.doorBody.enable = true;

        // Redraw closed door
        this.doorGraphics.clear();

        this.doorGraphics.fillStyle(
            0x151515,
            1
        );

        this.doorGraphics.fillRect(
            this.doorX - this.tileSize / 2,
            this.doorY - this.tileSize / 2,
            this.tileSize,  
            this.tileSize
        );

        this.doorGraphics.lineStyle(
            2,
            0xc8a96b,
            1
        );

        this.doorGraphics.strokeRect(
            this.doorX - this.tileSize / 2 + 3,
            this.doorY - this.tileSize / 2 + 3,
            this.tileSize - 6,
            this.tileSize - 6
        );
    }

    private startSleeping() {
        this.isSleeping = true;

        this.buildTiles.forEach((tile) => {
            tile.setBuildMode(true);
        });

        // Move the player to the center of the bed
        this.player.setPosition(
            this.bed.x,
            this.bed.y
        );

        // Stop all movement
        const body = this.player.body as Phaser.Physics.Arcade.Body;
        body.setVelocity(0, 0);

        // Hide interaction prompt
        this.interactText.setVisible(false);

        // Show sleeping state
        this.sleepingText.setVisible(true);

        this.sleepingText.setPosition(
            this.bed.x - 45,
            this.bed.y + 90
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

    private createBuildTiles() {

        const bedColumn = 5;
        const bedRow = 2;

        for (let row = 0; row < this.rows; row++) {

            for (let column = 0; column < this.columns; column++) {

                // Bed already occupies this tile.
                if (
                    column === bedColumn &&
                    row === bedRow
                ) {
                    continue;
                }

                const x =
                    this.roomX +
                    column * this.tileSize +
                    this.tileSize / 2;

                const y =
                    this.roomY +
                    row * this.tileSize +
                    this.tileSize / 2;

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