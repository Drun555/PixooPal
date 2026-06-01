import { WebSocketServer } from 'ws';

const EVENT_WS_PATHS = new Set(['/api/v1/events', '/ws/preview']);

/**
 * @param {{ on(event: 'upgrade', listener: (request: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void): unknown } | null | undefined} server
 */
export function attachPreviewWebSocketServer(server) {
  const state = getPreviewStreamState();

  if (!server || state.attachedServers.has(server)) {
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = request.url ? new URL(request.url, 'http://localhost') : undefined;

    if (!url || !EVENT_WS_PATHS.has(url.pathname)) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      state.clients.add(client);
      client.on('close', () => {
        state.clients.delete(client);
      });
      client.on('error', () => {
        state.clients.delete(client);
      });
    });
  });

  state.attachedServers.add(server);
}

function getPreviewStreamState() {
  const key = Symbol.for('pixoopal.previewStream');
  const scope = /** @type {typeof globalThis & Record<symbol, {
    clients: Set<import('ws').WebSocket>,
    attachedServers: WeakSet<object>,
    previewFrameListeners: Set<unknown>
  }>} */ (globalThis);

  scope[key] ??= {
    clients: new Set(),
    attachedServers: new WeakSet(),
    previewFrameListeners: new Set()
  };

  return scope[key];
}
