import Phaser from "phaser";
import { Player } from "../entities/Player";
import { Bed } from "../entities/Bed";

export class GameScene extends Phaser.Scene {
    private walls!: Phaser.Physics.Arcade.StaticGroup;
    private player!: Player;
    private bed!: Bed;
    private interactText!: Phaser.GameObjects.Text;

    private isSleeping = false;
    private coins = 0;
    private coinAccumulator = 0;

    private coinsText!: Phaser.GameObjects.Text;
    private sleepingText!: Phaser.GameObjects.Text;
    private buildGunText!: Phaser.GameObjects.Text;

    constructor() {
        super({ key: "GameScene" });
    }

    create() {
        this.walls = this.physics.add.staticGroup();
        
        this.createPlayerTexture();
        this.createRoom();

        this.bed = new Bed(
            this,
            640,
            320
        )

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
        if (this.isPlayerNearBed()) {
            this.toggleSleeping();
        }
        });

        this.buildGunText = this.add.text(
            40,
            130,
            "BUILD GUN  [50]",
            {
                fontFamily: "monospace",
                fontSize: "18px",
                color: "#ffffff",
                backgroundColor: "#222222",
                padding: {
                    x: 12,
                    y: 8,
                },
            }
        );

        this.buildGunText.setInteractive({
            useHandCursor: true,
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

        const nearBed = this.isPlayerNearBed();

        this.interactText.setVisible(nearBed);

        if (nearBed) {
            this.interactText.setPosition(
                this.bed.x - 40,
                this.bed.y + 90
            );
        }
    }

    private createRoom() {
        const graphics = this.add.graphics();

        const roomX = 340;
        const roomY = 140;
        const roomWidth = 600;
        const roomHeight = 440;

        graphics.fillStyle(0x242424, 1);
        graphics.fillRect(
            roomX, 
            roomY, 
            roomWidth, 
            roomHeight
        );

        //Walls
        graphics.lineStyle(6, 0x8a8a8a, 1);
        graphics.strokeRect(
            roomX,
            roomY,
            roomWidth,
            roomHeight
        );

        const doorWidth = 90;

        // Door
        const doorX = roomX + roomWidth / 2 - doorWidth / 2;
        const doorY = roomY + roomHeight - 6;

        graphics.fillStyle(0x151515, 1);
        graphics.fillRect(
            doorX,
            doorY,
            doorWidth,
            12
        );

        graphics.lineStyle(2, 0xc8a96b, 1);
        graphics.strokeRect(
            doorX,
            doorY,
            doorWidth,
            12
        );

        // Top wall
        const topWall = this.add.rectangle(
            roomX + roomWidth / 2,
            roomY,
            roomWidth,
            12
        );
        
        this.physics.add.existing(topWall, true);
        this.walls.add(topWall);

        // Bottom wall
        const bottomLeftWall = this.add.rectangle(
            roomX + (roomWidth - doorWidth) / 4,
            roomY + roomHeight,
            (roomWidth - doorWidth) / 2,
            12
        );

        this.physics.add.existing(bottomLeftWall, true);
        this.walls.add(bottomLeftWall);

        // Bottom wall - right section
        const bottomRightWall = this.add.rectangle(
        roomX + roomWidth - (roomWidth - doorWidth) / 4,
        roomY + roomHeight,
        (roomWidth - doorWidth) / 2,
        12
        );

        this.physics.add.existing(bottomRightWall, true);
        this.walls.add(bottomRightWall);

        // Left wall
        const leftWall = this.add.rectangle(
        roomX,
        roomY + roomHeight / 2,
        12,
        roomHeight
        );

        this.physics.add.existing(leftWall, true);
        this.walls.add(leftWall);

        // Right wall
        const rightWall = this.add.rectangle(
        roomX + roomWidth,
        roomY + roomHeight / 2,
        12,
        roomHeight
        );

        this.physics.add.existing(rightWall, true);
        this.walls.add(rightWall);
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

        return distance < 100;
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
        this.isSleeping = true;

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

        this.sleepingText.setVisible(false);

        const body = this.player.body as Phaser.Physics.Arcade.Body;
        body.setVelocity(0, 0);

        this.coinAccumulator = 0;
    }

}