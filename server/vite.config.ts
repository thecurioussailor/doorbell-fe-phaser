import { defineConfig } from "vite";
import { colyseus } from "colyseus/vite";

export default defineConfig(({ mode }) => ({
  build: { outDir: "dist/client" },
  // Vite's own dev-server CORS handling (server.cors, default true) runs
  // ahead of the Colyseus matchmaking middleware and answers preflight
  // OPTIONS requests itself using the "cors" package's defaults, which omit
  // Access-Control-Allow-Credentials. That short-circuits Colyseus's own
  // (already-correct) CORS headers, so the Doorbell frontend's credentialed
  // request to /matchmake/joinOrCreate/my_room gets rejected. Scoping this
  // to the frontend's dev origin with credentials enabled fixes it without
  // touching the matchmaking layer. Dev-only: `server.cors` has no effect
  // on `vite build` / the production listen() path.
  server: {
    cors: {
      origin: "http://localhost:5173",
      credentials: true,
    },
  },
  plugins: [
    // The plugin declares a second build environment (dist/server), so every
    // `vite build` builds both halves. `--mode client` drops it when you only
    // want the static client — e.g. deploying it separately from the server.
    // That mode also swaps which .env.* file Vite loads: .env.client, not
    // .env.production. Only matters once you add a VITE_-prefixed var.
    ...(mode === "client" ? [] : [colyseus({ serverEntry: "/src/app.config.ts" })]),
  ],
}));
