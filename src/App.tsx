import { useEffect } from 'react'
import './App.css'
import { createGame } from './game/Game'

function App() {
  useEffect(() => {
    const game = createGame()
    return () => {
      game.destroy(true)
    }
  }, [])

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

export default App;
