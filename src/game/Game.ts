import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import { GameScene, ROOM_REGISTRY_KEY } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,

    // This is the VIEWPORT, not the world — the arena
    // (server/src/shared/constants.ts ARENA_WIDTH/HEIGHT, now 1920x1440)
    // is intentionally larger than what's visible at once. GameScene's
    // camera follows the local player and scrolls within camera bounds
    // set to the full arena size. Scale.FIT below scales this viewport
    // resolution to whatever the browser window is.
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

export function createGame(room: Room) {
    return new Phaser.Game({
        ...config,
        callbacks: {
            // Before any scene's create(), so GameScene always finds the room.
            preBoot: (game) => game.registry.set(ROOM_REGISTRY_KEY, room),
        },
    });
}