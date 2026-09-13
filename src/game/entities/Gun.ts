import Phaser from "phaser";

export class Gun extends Phaser.GameObjects.Container {
    private gunBody: Phaser.GameObjects.Rectangle;
    private barrel: Phaser.GameObjects.Rectangle;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y);

        scene.add.existing(this);

        // Main gun body
        this.gunBody = scene.add.rectangle(
            0,
            0,
            32,
            24,
            0x4a4a4a
        );

        this.gunBody.setStrokeStyle(
            2,
            0x888888
        );

        // Barrel pointing upward
        this.barrel = scene.add.rectangle(
            0,
            -18,
            8,
            18,
            0x777777
        );

        this.barrel.setStrokeStyle(
            1,
            0xaaaaaa
        );

        this.add([
            this.gunBody,
            this.barrel,
        ]);
    }
}