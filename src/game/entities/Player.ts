import Phaser from "phaser";

export class Player extends Phaser.Physics.Arcade.Sprite {
    private speed = 200;

    private cursors: Phaser.Types.Input.Keyboard.CursorKeys;

    private wasd: {
        W: Phaser.Input.Keyboard.Key;
        A: Phaser.Input.Keyboard.Key;
        S: Phaser.Input.Keyboard.Key;
        D: Phaser.Input.Keyboard.Key;
    };

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
        const body = this.body as Phaser.Physics.Arcade.Body;

        body.setVelocity(0);

        if (this.cursors.left.isDown || this.wasd.A.isDown) {
            body.setVelocityX(-this.speed);
        }
        if (this.cursors.right.isDown || this.wasd.D.isDown) {
            body.setVelocityX(this.speed);
        }
        if (this.cursors.down.isDown || this.wasd.S.isDown) {
            body.setVelocityY(this.speed);
        }
        if (this.cursors.up.isDown || this.wasd.W.isDown) {
            body.setVelocityY(-this.speed);
        }

       body.velocity.normalize().scale(this.speed);
    }
}