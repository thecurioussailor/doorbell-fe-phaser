import Phaser from "phaser";

/**
 * Visual-only stand-in for a networked player. Deliberately not a
 * Phaser.Physics.Arcade.Sprite and does not read keyboard input — this
 * milestone only proves state sync, not remote movement.
 */
export class RemotePlayer extends Phaser.GameObjects.Sprite {
    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, "player");

        scene.add.existing(this);

        this.setDisplaySize(32, 32);
        this.setTint(0xc86b6b);
    }
}
