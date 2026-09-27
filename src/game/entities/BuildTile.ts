import Phaser from "phaser";

export class BuildTile extends Phaser.GameObjects.Container {
    private background: Phaser.GameObjects.Rectangle;
    private plusText: Phaser.GameObjects.Text;

    public isOccupied = false;

    // Which room this slot belongs to and its index within that room's
    // build tiles — mirrors server/src/shared/constants.ts's
    // ROOM_BUILD_TILES ordering exactly, since a "build" request names a
    // tile only by this tileIndex (the server derives the room from the
    // player's own authoritative roomIndex, never from this).
    public readonly roomIndex: number;
    public readonly tileIndex: number;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        size: number,
        roomIndex: number,
        tileIndex: number,
        onClick: (tile: BuildTile) => void
    ) {
        super(scene, x, y);

        this.roomIndex = roomIndex;
        this.tileIndex = tileIndex;

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