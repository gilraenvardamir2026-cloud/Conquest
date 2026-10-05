import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the client runs on 5173 and forwards the API and the room
// WebSocket to the server on 3001 (`npm run dev` starts both).
const server = process.env.CONQUEST_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
});
