import { Client, type Room } from "@colyseus/sdk";

const client = new Client("http://localhost:5174");

/** Mirrors server/src/shared/roomCode.ts normalizeRoomCode. */
export function normalizeRoomCode(input: string): string {
    return input.trim().toUpperCase();
}

/** CREATE ROOM: a brand-new room; the creator is its host. */
export function createRoom(): Promise<Room> {
    return client.create("my_room");
}

/** JOIN ROOM: joins an existing room by its code — never creates one. */
export function joinRoom(code: string): Promise<Room> {
    return client.joinById(normalizeRoomCode(code));
}

/** Turns matchmaking failures into something a player can act on. */
export function describeJoinError(error: unknown, code: string): string {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("not found")) {
        return `No room with code ${normalizeRoomCode(code)}.`;
    }
    // Colyseus locks a room when it's full, and startGame locks it too.
    if (message.includes("locked") || message.includes("full") || message.includes("already started")) {
        return "That room is full or its match has already started.";
    }
    return `Could not join: ${message}`;
}
