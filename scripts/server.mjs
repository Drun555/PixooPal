import { createServer } from 'node:http';
import { handler } from '../build/handler.js';
import { advertisePixooPal } from './discovery.mjs';
import { attachPreviewWebSocketServer } from './preview-stream.mjs';
import { registerSupervisorDiscovery } from './supervisor-discovery.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '5173', 10);
const server = createServer((request, response) => {
  handler(request, response);
});

attachPreviewWebSocketServer(server);

let stopDiscovery = () => {};

server.listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}`);
  stopDiscovery = advertisePixooPal(port);
  registerSupervisorDiscovery(port);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopDiscovery();
    server.close(() => {
      process.exit(0);
    });
  });
}
