import { WebSocketServer } from 'ws';
import sharp from 'sharp';

const EVENT_WS_PATHS = new Set(['/api/v1/events', '/ws/preview']);
const PREVIEW_WS_PATHS = new Set(['/api/v1/preview.ws']);
const OPEN_SOCKET_STATE = 1;
const JPEG_PREVIEW_SCALE = 8;
const PREVIEW_WS_MIN_FRAME_INTERVAL_MS = 100;

/**
 * @typedef {{
 *   activeId: string,
 *   updateIntervalMs: number,
 *   preview: { size: number, buffer: Uint8Array }
 * }} PreviewFrame
 */

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

    if (!url || (!isEventWebSocketPath(url.pathname) && !isPreviewWebSocketPath(url.pathname))) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      if (isPreviewWebSocketPath(url.pathname)) {
        attachPreviewClient(state, client);
        return;
      }

      attachEventClient(state, client);
    });
  });

  state.attachedServers.add(server);
}

/**
 * @param {string} pathname
 */
function isEventWebSocketPath(pathname) {
  return EVENT_WS_PATHS.has(pathname) || [...EVENT_WS_PATHS].some((path) => pathname.endsWith(path));
}

/**
 * @param {string} pathname
 */
function isPreviewWebSocketPath(pathname) {
  return PREVIEW_WS_PATHS.has(pathname) || [...PREVIEW_WS_PATHS].some((path) => pathname.endsWith(path));
}

/**
 * @param {ReturnType<typeof getPreviewStreamState>} state
 * @param {import('ws').WebSocket} client
 */
function attachEventClient(state, client) {
  state.clients.add(client);
  client.on('close', () => {
    state.clients.delete(client);
  });
  client.on('error', () => {
    state.clients.delete(client);
  });
}

/**
 * @param {ReturnType<typeof getPreviewStreamState>} state
 * @param {import('ws').WebSocket} client
 */
function attachPreviewClient(state, client) {
  let closed = false;
  let encoding = false;
  let lastSentAt = 0;
  /** @type {PreviewFrame | undefined} */
  let pendingFrame;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pendingTimer;

  const cleanup = () => {
    closed = true;
    clearTimeout(pendingTimer);
    state.previewFrameListeners.delete(scheduleFrame);
  };

  /** @param {PreviewFrame} frame */
  const sendFrame = async (frame) => {
    if (closed || client.readyState !== OPEN_SOCKET_STATE) {
      return;
    }

    encoding = true;
    lastSentAt = Date.now();

    try {
      const jpeg = await previewPayloadToJpeg(frame.preview);

      if (!closed && client.readyState === OPEN_SOCKET_STATE) {
        client.send(jpeg, { binary: true });
      }
    } catch (error) {
      console.error('[PixooPal] Preview WebSocket frame encode failed:', error);
    } finally {
      encoding = false;

      const nextFrame = pendingFrame;
      pendingFrame = undefined;

      if (nextFrame && !closed) {
        scheduleFrame(nextFrame);
      }
    }
  };

  /** @param {PreviewFrame} frame */
  const scheduleFrame = (frame) => {
    pendingFrame = frame;

    if (closed || encoding || pendingTimer) {
      return;
    }

    const remaining = Math.max(0, PREVIEW_WS_MIN_FRAME_INTERVAL_MS - (Date.now() - lastSentAt));
    pendingTimer = setTimeout(() => {
      const nextFrame = pendingFrame;
      pendingFrame = undefined;
      pendingTimer = undefined;

      if (nextFrame && !closed) {
        sendFrame(nextFrame);
      }
    }, remaining);
  };

  client.on('close', cleanup);
  client.on('error', cleanup);
  state.previewFrameListeners.add(scheduleFrame);

  if (state.latestPreview) {
    scheduleFrame(state.latestPreview);
  }
}

/**
 * @param {{ size: number, buffer: Uint8Array }} preview
 */
async function previewPayloadToJpeg(preview) {
  const size = preview.size;
  const expectedLength = size * size * 3;
  let buffer;

  if (preview.buffer.length >= expectedLength) {
    buffer = Buffer.from(preview.buffer.buffer, preview.buffer.byteOffset, expectedLength);
  } else {
    const padded = new Uint8Array(expectedLength);
    padded.set(preview.buffer);
    buffer = Buffer.from(padded.buffer);
  }

  return sharp(buffer, {
    raw: {
      width: size,
      height: size,
      channels: 3
    }
  })
    .resize(size * JPEG_PREVIEW_SCALE, size * JPEG_PREVIEW_SCALE, {
      kernel: 'nearest'
    })
    .jpeg({
      chromaSubsampling: '4:4:4',
      quality: 100
    })
    .toBuffer();
}

function getPreviewStreamState() {
  const key = Symbol.for('pixoopal.previewStream');
  const scope = /** @type {typeof globalThis & Record<symbol, {
    clients: Set<import('ws').WebSocket>,
    attachedServers: WeakSet<object>,
    latestPreview?: PreviewFrame,
    previewFrameListeners: Set<(frame: PreviewFrame) => void>
  }>} */ (globalThis);

  scope[key] ??= {
    clients: new Set(),
    attachedServers: new WeakSet(),
    previewFrameListeners: new Set()
  };

  return scope[key];
}
