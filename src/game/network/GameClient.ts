import { Client } from "@colyseus/sdk";

export class GameClient {
    private client: Client;

    constructor() {
        this.client = new Client("http://localhost:5174");
    }

    async connect() {
        const room = await this.client.joinOrCreate("my_room");

        console.log("Connected to Colyseus!");
        console.log("Session ID:", room.sessionId);

        return room;
    }
}