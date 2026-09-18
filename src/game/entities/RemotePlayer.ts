import Phaser from "phaser";

const AWAKE_TINT = 0xc86b6b;
const SLEEPING_TINT = 0x7a4646;

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
        this.setTint(AWAKE_TINT);
    }

    // Dims the existing red tint rather than adding new visual elements —
    // enough to tell a sleeping remote player apart from a moving one.
    setSleeping(isSleeping: boolean) {
        this.setTint(isSleeping ? SLEEPING_TINT : AWAKE_TINT);
    }
}
