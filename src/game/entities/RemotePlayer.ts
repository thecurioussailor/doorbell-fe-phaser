import Phaser from "phaser";

const AWAKE_TINT = 0xc86b6b;
const SLEEPING_TINT = 0x7a4646;
export const GHOST_TINT = 0x8fd8ff;
export const GHOST_ALPHA = 0.75;

/**
 * Visual-only stand-in for a networked player. Deliberately not a
 * Phaser.Physics.Arcade.Sprite and does not read keyboard input — this
 * milestone only proves state sync, not remote movement.
 */
export class RemotePlayer extends Phaser.GameObjects.Sprite {
    private isSleeping = false;
    private isGhost = false;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, "player");

        scene.add.existing(this);

        this.setDisplaySize(32, 32);
        this.applyTint();
    }

    // Dims the existing red tint rather than adding new visual elements —
    // enough to tell a sleeping remote player apart from a moving one.
    setSleeping(isSleeping: boolean) {
        this.isSleeping = isSleeping;
        this.applyTint();
    }

    // Driven only by the synced `role` field — the client never decides who the Ghost is.
    setRole(role: string) {
        this.isGhost = role === "ghost";
        this.applyTint();
    }

    private applyTint() {
        if (this.isGhost) {
            this.setTint(GHOST_TINT);
            this.setAlpha(GHOST_ALPHA);
            return;
        }

        this.setTint(this.isSleeping ? SLEEPING_TINT : AWAKE_TINT);
        this.setAlpha(1);
    }
}
