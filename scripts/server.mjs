import { createServer } from 'node:http';
import { handler } from '../build/handler.js';
import { attachPreviewWebSocketServer } from './preview-stream.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const server = createServer(handler);

attachPreviewWebSocketServer(server);

server.listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}`);
});
