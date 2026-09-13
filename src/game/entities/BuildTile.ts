import Phaser from "phaser";

export class BuildTile extends Phaser.GameObjects.Container {
    private background: Phaser.GameObjects.Rectangle;
    private plusText: Phaser.GameObjects.Text;

    public isOccupied = false;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        size: number,
        onClick: (tile: BuildTile) => void
    ) {
        super(scene, x, y);

        scene.add.existing(this);

        // Tile background
        this.background = scene.add.rectangle(
            0,
            0,
            size,
            size,
            0x292929
        );

        this.background.setStrokeStyle(
            1,
            0x444444
        );

        // Plus sign
        this.plusText = scene.add.text(
            0,
            0,
            "+",
            {
                fontFamily: "monospace",
                fontSize: "28px",
                color: "#777777",
            }
        );

        this.plusText.setOrigin(0.5);

        this.add([
            this.background,
            this.plusText,
        ]);

        // Make the tile clickable
        this.background.setInteractive({
            useHandCursor: true,
        });

        this.background.on("pointerdown", () => {
            if (!this.isOccupied) {
                onClick(this);
            }
        });

        // Hidden until sleeping
        this.setVisible(false);
    }

    public setOccupied(occupied: boolean) {
        this.isOccupied = occupied;

        this.plusText.setVisible(!occupied);
    }
    public setBuildMode(enabled: boolean) {
        this.setVisible(enabled);
    }
}