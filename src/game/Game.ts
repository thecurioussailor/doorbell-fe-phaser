import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,

    width: 1280,
    height: 720,

    backgroundColor: "#111111",

    parent: "game-container",

    scene: [GameScene],

    physics: {
        default: "arcade",
        arcade: {
            debug: false,
        },
    },

    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
};

export function createGame() {
    return new Phaser.Game(config);
}