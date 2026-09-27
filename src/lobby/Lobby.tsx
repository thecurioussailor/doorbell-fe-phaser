import { useEffect, useState, type CSSProperties } from "react";
import type { Room } from "@colyseus/sdk";
import { createRoom, joinRoom, describeJoinError } from "../game/network/GameClient";

const MAX_PLAYERS = 5; // mirrors server MAX_PLAYERS; the server enforces it

const page: CSSProperties = {
    minHeight: "100vh",
    background: "#111111",
    color: "#d6d6d6",
    fontFamily: "monospace",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    boxSizing: "border-box",
};

const panel: CSSProperties = {
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    gap: 14,
};

const button: CSSProperties = {
    fontFamily: "monospace",
    fontSize: 16,
    padding: "10px 14px",
    background: "#222222",
    color: "#ffffff",
    border: "1px solid #555555",
    cursor: "pointer",
};

const disabledButton: CSSProperties = { ...button, opacity: 0.4, cursor: "not-allowed" };

const title: CSSProperties = { fontSize: 32, color: "#ffffff", margin: 0 };

interface MenuProps {
    onJoined: (room: Room) => void;
    notice?: string;
}

export function MenuScreen({ onJoined, notice }: MenuProps) {
    const [code, setCode] = useState("");
    const [error, setError] = useState(notice ?? "");
    const [busy, setBusy] = useState(false);

    async function handleCreate() {
        setBusy(true);
        setError("");
        try {
            onJoined(await createRoom());
        } catch (e) {
            setError(`Could not create a room: ${e instanceof Error ? e.message : String(e)}`);
            setBusy(false);
        }
    }

    async function handleJoin() {
        if (!code.trim()) {
            setError("Enter a room code.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            onJoined(await joinRoom(code));
        } catch (e) {
            setError(describeJoinError(e, code));
            setBusy(false);
        }
    }

    return (
        <div style={page}>
            <div style={panel}>
                <h1 style={title}>DOORBELL</h1>

                <button style={busy ? disabledButton : button} disabled={busy} onClick={handleCreate}>
                    CREATE ROOM
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { handleJoin(); } }}
                        placeholder="ROOM CODE"
                        maxLength={8}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            fontFamily: "monospace",
                            fontSize: 16,
                            padding: "10px 12px",
                            background: "#181818",
                            color: "#ffffff",
                            border: "1px solid #555555",
                            textTransform: "uppercase",
                        }}
                    />
                    <button style={busy ? disabledButton : button} disabled={busy} onClick={handleJoin}>
                        JOIN ROOM
                    </button>
                </div>

                {error && <div style={{ color: "#d64545" }}>{error}</div>}
            </div>
        </div>
    );
}

interface LobbyPlayer {
    sessionId: string;
    playerNumber: number;
    ready: boolean;
}

interface LobbySnapshot {
    code: string;
    hostId: string;
    phase: string;
    players: LobbyPlayer[];
}

function snapshotOf(room: Room): LobbySnapshot {
    const state: any = room.state;
    const players: LobbyPlayer[] = [];

    state?.players?.forEach((player: any, sessionId: string) => {
        players.push({ sessionId, playerNumber: player.playerNumber, ready: player.ready });
    });
    players.sort((a, b) => a.playerNumber - b.playerNumber);

    return {
        code: state?.roomCode || room.roomId,
        hostId: state?.hostId ?? "",
        phase: state?.phase ?? "lobby",
        players,
    };
}

interface LobbyProps {
    room: Room;
    onMatchStarted: () => void;
    onLeft: (notice?: string) => void;
}

export function LobbyScreen({ room, onMatchStarted, onLeft }: LobbyProps) {
    const [snapshot, setSnapshot] = useState(() => snapshotOf(room));
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const onChange = () => setSnapshot(snapshotOf(room));
        const onLeave = () => onLeft("Disconnected from the room.");

        room.onStateChange(onChange);
        room.onLeave(onLeave);
        onChange();

        return () => {
            room.onStateChange.remove(onChange);
            room.onLeave.remove(onLeave);
        };
    }, [room, onLeft]);

    // The server's phase is the only signal to leave the lobby.
    useEffect(() => {
        if (snapshot.phase !== "lobby") {
            onMatchStarted();
        }
    }, [snapshot.phase, onMatchStarted]);

    const me = snapshot.players.find((p) => p.sessionId === room.sessionId);
    const isHost = snapshot.hostId === room.sessionId;
    const everyoneReady = snapshot.players.length > 0 && snapshot.players.every((p) => p.ready);
    const canStart = isHost && snapshot.players.length === MAX_PLAYERS && everyoneReady;

    let startHint = "";
    if (snapshot.players.length !== MAX_PLAYERS) {
        startHint = `Need ${MAX_PLAYERS} players (${snapshot.players.length}/${MAX_PLAYERS}).`;
    } else if (!everyoneReady) {
        startHint = "Everyone must be ready.";
    }

    async function copyCode() {
        try {
            await navigator.clipboard.writeText(snapshot.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard can be unavailable (non-secure origin); the code is on screen anyway.
        }
    }

    async function leave() {
        await room.leave();
        onLeft();
    }

    return (
        <div style={page}>
            <div style={panel}>
                <h1 style={title}>DOORBELL</h1>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span>ROOM CODE:</span>
                    <span style={{ fontSize: 24, color: "#ffffff", letterSpacing: 3 }}>{snapshot.code}</span>
                    <button style={button} onClick={copyCode}>{copied ? "COPIED" : "COPY"}</button>
                </div>

                <div>PLAYERS {snapshot.players.length}/{MAX_PLAYERS}</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {snapshot.players.map((p) => (
                        <div
                            key={p.sessionId}
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "6px 10px",
                                border: "1px solid #333333",
                                background: p.sessionId === room.sessionId ? "#1c1c1c" : "transparent",
                            }}
                        >
                            <span>
                                {p.sessionId === snapshot.hostId ? "👑 " : "   "}
                                Player {p.playerNumber}
                                {p.sessionId === room.sessionId ? " (you)" : ""}
                            </span>
                            <span style={{ color: p.ready ? "#7fd87f" : "#888888" }}>
                                {p.ready ? "READY" : "NOT READY"}
                            </span>
                        </div>
                    ))}
                </div>

                <button style={button} onClick={() => room.send("ready", { ready: !me?.ready })}>
                    {me?.ready ? "UNREADY" : "READY"}
                </button>

                {isHost && (
                    <>
                        <button
                            style={canStart ? button : disabledButton}
                            disabled={!canStart}
                            onClick={() => room.send("startGame")}
                        >
                            START GAME
                        </button>
                        {startHint && <div style={{ color: "#888888" }}>{startHint}</div>}
                    </>
                )}

                {!isHost && <div style={{ color: "#888888" }}>Waiting for the host to start.</div>}

                <button style={{ ...button, background: "transparent" }} onClick={leave}>
                    LEAVE
                </button>
            </div>
        </div>
    );
}
