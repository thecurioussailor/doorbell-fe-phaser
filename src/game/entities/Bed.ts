import Phaser from 'phaser';

export class Bed extends Phaser.GameObjects.Container {
    private bedBody: Phaser.GameObjects.Rectangle;
    private pillow: Phaser.GameObjects.Rectangle;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y);

        scene.add.existing(this);

        // Bed fits inside one 60x60 tile
        this.bedBody = scene.add.rectangle(
            0,
            0,
            52,
            52,
            0x3a3a3a
        );

        this.bedBody.setStrokeStyle(2, 0x777777);

        // Pillow
        this.pillow = scene.add.rectangle(
            0,
            -14,
            32,
            12,
            0x707070
        );

        this.pillow.setStrokeStyle(1, 0x999999);

        this.add([
            this.bedBody,
            this.pillow,
        ]);
    }
}