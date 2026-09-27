import { useCallback, useEffect, useState } from 'react'
import type { Room } from '@colyseus/sdk'
import './App.css'
import { createGame } from './game/Game'
import { MenuScreen, LobbyScreen } from './lobby/Lobby'

type Screen =
  | { kind: "menu"; notice?: string }
  | { kind: "lobby"; room: Room }
  | { kind: "game"; room: Room }

function GameView({ room }: { room: Room }) {
  useEffect(() => {
    // Same Colyseus room/session as the lobby — no second connection.
    const game = createGame(room)
    return () => {
      game.destroy(true)
    }
  }, [room])

  return (
    <div
      id="game-container"
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "menu" })

  const onLeft = useCallback((notice?: string) => setScreen({ kind: "menu", notice }), [])

  if (screen.kind === "menu") {
    return <MenuScreen notice={screen.notice} onJoined={(room) => setScreen({ kind: "lobby", room })} />
  }

  if (screen.kind === "lobby") {
    const room = screen.room
    return (
      <LobbyScreen
        room={room}
        onMatchStarted={() => setScreen({ kind: "game", room })}
        onLeft={onLeft}
      />
    )
  }

  return <GameView room={screen.room} />
}

export default App;
