import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const devServerPort = Number(env.VITE_DEV_SERVER_PORT || 5174);
    return {
      base: './',
      server: {
        port: devServerPort,
        strictPort: true,
        host: '0.0.0.0',
        headers: {
          'Cache-Control': 'no-store',
        },
        proxy: {
          '/api': { target: 'http://localhost:3001', changeOrigin: true },
        },
      },
      plugins: [
        {
          name: 'motor-world-dev-banner',
          configureServer(server) {
            server.httpServer?.once('listening', () => {
              const addr = server.httpServer?.address();
              const port =
                addr && typeof addr === 'object' && 'port' in addr ? String(addr.port) : '';
              const backend = String(env.VITE_DATA_BACKEND || 'rest').toLowerCase().trim();
              console.log(
                `\n[motor-world] Vite is bound to port ${port} in this folder (see VITE_DEV_SERVER_PORT in .env). Electron opens this in dev.\n` +
                  `[motor-world] VITE_DATA_BACKEND=${backend} → ${backend === 'firebase' ? 'Firebase Auth + Firestore (login screen).' : 'local REST + SQLite; Vite proxies /api to port 3001 — use `npm run dev` so API + UI both start.'}\n` +
                  'Public landing: http://127.0.0.1:' +
                  port +
                  '/  ·  Staff app: http://127.0.0.1:' +
                  port +
                  '/aiosystem\n' +
                  'If the UI looks ancient, you were probably hitting a different server — this project avoids port 3000 on purpose.\n',
              );
            });
          },
        },
        react(),
        tailwindcss(),
      ],
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            viewer: path.resolve(__dirname, 'viewer.html'),
          },
        },
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          // Electron can resolve the Node build and crash the renderer; force the browser bundle.
          '@google/genai': path.resolve(__dirname, 'node_modules/@google/genai/dist/web/index.mjs'),
        },
      },
    };
});
