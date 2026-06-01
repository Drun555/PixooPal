import { createServer } from 'node:http';
import { handler } from '../build/handler.js';
import { advertisePixooPal } from './discovery.mjs';
import { attachPreviewWebSocketServer } from './preview-stream.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '5173', 10);
const server = createServer((request, response) => {
  const startedAt = Date.now();
  const url = request.url ?? '';

  response.on('finish', () => {
    if (!shouldLogRequest(url)) {
      return;
    }

    console.log(
      `[PixooPal] HTTP ${request.method ?? 'GET'} ${url} -> ${response.statusCode} (${Date.now() - startedAt}ms)`
    );
  });

  handler(request, response);
});

attachPreviewWebSocketServer(server);

let stopDiscovery = () => {};

server.listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}`);
  stopDiscovery = advertisePixooPal(port);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopDiscovery();
    server.close(() => {
      process.exit(0);
    });
  });
}

function shouldLogRequest(url) {
  return url.startsWith('/api/') || url.includes('/api/');
}
