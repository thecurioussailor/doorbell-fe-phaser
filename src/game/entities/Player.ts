import Phaser from "phaser";

export class Player extends Phaser.Physics.Arcade.Sprite {
    private cursors: Phaser.Types.Input.Keyboard.CursorKeys;

    private wasd: {
        W: Phaser.Input.Keyboard.Key;
        A: Phaser.Input.Keyboard.Key;
        S: Phaser.Input.Keyboard.Key;
        D: Phaser.Input.Keyboard.Key;
    };

    // -1, 0, or 1 on each axis. Read by GameScene and sent to the server as
    // MoveInput — the server is authoritative, so this is intent, not motion.
    private moveX = 0;
    private moveY = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, "player");

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.setDisplaySize(32, 32);

        this.setTint(0x6d6d6d);

        this.cursors = scene.input.keyboard!.createCursorKeys();
        
        this.wasd = scene.input.keyboard!.addKeys(
            "W,A,S,D"
        ) as typeof this.wasd;

        this.setCollideWorldBounds(false);
    }

    update() {
        let moveX = 0;
        let moveY = 0;

        if (this.cursors.left.isDown || this.wasd.A.isDown) {
            moveX -= 1;
        }
        if (this.cursors.right.isDown || this.wasd.D.isDown) {
            moveX += 1;
        }
        if (this.cursors.up.isDown || this.wasd.W.isDown) {
            moveY -= 1;
        }
        if (this.cursors.down.isDown || this.wasd.S.isDown) {
            moveY += 1;
        }

        this.moveX = moveX;
        this.moveY = moveY;
    }

    getInput(): { moveX: number; moveY: number } {
        return { moveX: this.moveX, moveY: this.moveY };
    }

    // The server is authoritative over position — this snaps both the body
    // and the game object to it. `body.reset()` (not `setPosition()`) because
    // Arcade Physics writes the body's own tracked position back onto the
    // game object every step; setPosition() alone would get overwritten on
    // the next physics tick.
    applyServerPosition(x: number, y: number) {
        const body = this.body as Phaser.Physics.Arcade.Body;
        body.reset(x, y);
    }
}