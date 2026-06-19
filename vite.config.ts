import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite';
import { prepareDivoomInitV2GetBody } from './scripts/divoom-initv2-get-body.mjs';
import { startPixooMitmMqttBroker } from './src/lib/server/mqtt/broker';
import { attachPreviewWebSocketServer } from './scripts/preview-stream.mjs';

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: 'pixoopal-divoom-initv2-get-body',
      enforce: 'pre',
      configureServer(server) {
        startPixooMitmMqttBroker();
        server.middlewares.use(createInitV2GetBodyMiddleware());
      },
      configurePreviewServer(server) {
        startPixooMitmMqttBroker();
        server.middlewares.use(createInitV2GetBodyMiddleware());
      }
    },
    sveltekit(),
    {
      name: 'pixoopal-preview-websocket',
      configureServer(server) {
        attachPreviewWebSocketServer(server.httpServer);
        startMitmHttpsServer(server, 'dev');
      },
      configurePreviewServer(server) {
        attachPreviewWebSocketServer(server.httpServer);
        startMitmHttpsServer(server, 'preview');
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: ["app.divoom-gz.com"]
  }
});

function createInitV2GetBodyMiddleware() {
  return async (request: IncomingMessage, _response: ServerResponse, next: (error?: unknown) => void) => {
    try {
      await prepareDivoomInitV2GetBody(request);
    } catch (error) {
      console.warn(
        `[PixooPal MITM] Could not read raw GET /Device/InitV2 body: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    next();
  };
}

function startMitmHttpsServer(server: ViteDevServer | PreviewServer, mode: string) {
  const httpsPort = parseOptionalPort(process.env.HTTPS_PORT);

  if (!httpsPort) {
    return;
  }

  const host = process.env.HOST ?? '0.0.0.0';
  const httpPort = Number.parseInt(process.env.HTTP_PORT ?? process.env.PORT ?? '', 10);

  if (httpsPort === httpPort) {
    console.warn('[PixooPal] HTTPS_PORT must differ from HTTP_PORT; dev HTTPS listener skipped.');
    return;
  }

  const httpsServer = createServer(
    {
      key: readFileSync(join(appRoot, 'app-divoom-gz.com-privateKey.key')),
      cert: readFileSync(join(appRoot, 'app-divoom-gz.com.crt'))
    },
    server.middlewares
  );

  attachPreviewWebSocketServer(httpsServer);

  httpsServer.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      `[PixooPal] Could not listen on https://${host}:${httpsPort} for Vite ${mode}: ${error.code || error.message}`
    );
  });

  httpsServer.listen(httpsPort, host, () => {
    console.log(
      `[PixooPal] Vite ${mode} HTTPS listening on https://${host}:${httpsPort} with self-signed certificate`
    );
  });

  server.httpServer?.once('close', () => {
    httpsServer.close();
  });
}

function parseOptionalPort(value: unknown) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
