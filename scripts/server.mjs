import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './load-env.mjs';
import { handler } from '../build/handler.js';
import { prepareDivoomInitV2GetBody } from './divoom-initv2-get-body.mjs';
import { advertisePixooPal } from './discovery.mjs';
import { startPixooMitmMqttBroker, stopPixooMitmMqttBroker } from './mitm-mqtt-broker.mjs';
import { attachPreviewWebSocketServer } from './preview-stream.mjs';
import { registerSupervisorDiscovery } from './supervisor-discovery.mjs';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const host = process.env.HOST ?? '0.0.0.0';
const httpPort = parsePort(process.env.HTTP_PORT ?? process.env.PORT, 5173);
const httpsPort = parseOptionalPort(process.env.HTTPS_PORT);
const servers = [];
await startPixooMitmMqttBroker();
const httpServer = createHttpServer(handleRequest);

attachPreviewWebSocketServer(httpServer);
httpServer.on('error', (error) => {
  console.error(`[PixooPal] Could not listen on http://${host}:${httpPort}: ${error.code || error.message}`);
});
servers.push(httpServer);

let stopDiscovery = () => {};

httpServer.listen(httpPort, host, () => {
  console.log(`Listening on http://${host}:${httpPort}`);
  stopDiscovery = advertisePixooPal(httpPort);
  registerSupervisorDiscovery(httpPort);
});

if (httpsPort) {
  if (httpsPort === httpPort) {
    throw new Error('[PixooPal] HTTPS_PORT must differ from HTTP_PORT.');
  }

  const httpsServer = createHttpsServer(getHttpsOptions(), handleRequest);

  attachPreviewWebSocketServer(httpsServer);
  httpsServer.on('error', (error) => {
    console.error(`[PixooPal] Could not listen on https://${host}:${httpsPort}: ${error.code || error.message}`);
  });
  servers.push(httpsServer);

  httpsServer.listen(httpsPort, host, () => {
    console.log(`Listening on https://${host}:${httpsPort} with self-signed certificate`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopDiscovery();
    stopPixooMitmMqttBroker();
    let remaining = servers.length;

    for (const server of servers) {
      server.close(() => {
        remaining -= 1;

        if (remaining === 0) {
          process.exit(0);
        }
      });
    }
  });
}

function getHttpsOptions() {
  return {
    key: readFileSync(join(appRoot, 'app-divoom-gz.com-privateKey.key')),
    cert: readFileSync(join(appRoot, 'app-divoom-gz.com.crt'))
  };
}

async function handleRequest(request, response) {
  try {
    await prepareDivoomInitV2GetBody(request);
  } catch (error) {
    console.warn(
      `[PixooPal MITM] Could not read raw GET /Device/InitV2 body: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  handler(request, response);
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPort(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
