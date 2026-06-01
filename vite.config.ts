import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { attachPreviewWebSocketServer } from './scripts/preview-stream.mjs';

export default defineConfig({
  plugins: [
    sveltekit(),
    {
      name: 'pixoopal-preview-websocket',
      configureServer(server) {
        attachPreviewWebSocketServer(server.httpServer);
      }
    }
  ],
  server: {
    host: '0.0.0.0'
  }
});
