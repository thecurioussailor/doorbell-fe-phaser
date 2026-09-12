import Phaser from "phaser";

export class Gun extends Phaser.GameObjects.Container {
    private gunBody: Phaser.GameObjects.Rectangle;
    private barrel: Phaser.GameObjects.Rectangle;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number
    ) {
        super(scene, x, y);;

        scene.add.existing(this);

        //Gun base
        this.gunBody = scene.add.rectangle(
            0,
            0,
            42,
            42,
            0x3a3a3a
        );

        this.gunBody.setStrokeStyle(
            2,
            0x888888
        );

        // Gun barrel
        this.barrel = scene.add.rectangle(
            0,
            -20,
            8,
            28,
            0xaaaaaa
        );

        this.add([
            this.gunBody,
            this.barrel,
        ]);
    }
}