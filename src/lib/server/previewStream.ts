import sharp from 'sharp';

export type PreviewPayload = {
  size: number;
  buffer: number[];
};

export type PreviewFrame = {
  activeId: string;
  updateIntervalMs: number;
  preview: PreviewPayload;
};

export type PixooPalEvent =
  | ({ type: 'preview' } & PreviewFrame)
  | { type: 'clockface_changed'; activeId: string; clockface: unknown }
  | { type: 'clockface_data_changed'; activeId: string; data: Record<string, string> }
  | { type: 'device_status'; reachable: boolean; status: unknown }
  | { type: 'notification'; message: string; beep: boolean };

type PreviewFrameListener = (frame: PreviewFrame) => void;

type LatestPreviewFrame = PreviewFrame & {
  jpeg?: Buffer;
};

type PreviewStreamState = {
  clients: Set<PreviewSocket>;
  attachedServers: WeakSet<object>;
  latestPreview?: LatestPreviewFrame;
  previewFrameListeners: Set<PreviewFrameListener>;
};

type PreviewSocket = {
  readyState: number;
  send(payload: string): void;
};

const OPEN_SOCKET_STATE = 1;
const JPEG_PREVIEW_SCALE = 8;
const previewStreamState = getPreviewStreamState();

export function publishPreviewFrame(frame: PreviewFrame) {
  previewStreamState.latestPreview = {
    ...frame,
    preview: {
      size: frame.preview.size,
      buffer: [...frame.preview.buffer]
    }
  };

  publishPixooPalEvent({
    type: 'preview',
    ...frame
  });

  for (const listener of previewStreamState.previewFrameListeners) {
    listener(frame);
  }
}

export function publishPixooPalEvent(event: PixooPalEvent) {
  const payload = JSON.stringify(event);

  for (const client of previewStreamState.clients) {
    if (client.readyState === OPEN_SOCKET_STATE) {
      client.send(payload);
    } else {
      previewStreamState.clients.delete(client);
    }
  }
}

export function subscribePreviewFrames(listener: PreviewFrameListener) {
  previewStreamState.previewFrameListeners.add(listener);

  return () => {
    previewStreamState.previewFrameListeners.delete(listener);
  };
}

export function getLatestPreviewFrame() {
  return previewStreamState.latestPreview;
}

export function getEmptyPreviewFrame(): PreviewFrame {
  return {
    activeId: '',
    updateIntervalMs: 0,
    preview: {
      size: 64,
      buffer: new Array(64 * 64 * 3).fill(0)
    }
  };
}

export async function getLatestPreviewJpeg() {
  const frame = previewStreamState.latestPreview ?? getEmptyPreviewFrame();

  if (previewStreamState.latestPreview?.jpeg) {
    return previewStreamState.latestPreview.jpeg;
  }

  const jpeg = await previewPayloadToJpeg(frame.preview);

  if (previewStreamState.latestPreview === frame) {
    previewStreamState.latestPreview.jpeg = jpeg;
  }

  return jpeg;
}

export async function previewPayloadToJpeg(preview: PreviewPayload) {
  const size = preview.size;
  const expectedLength = size * size * 3;
  const source = preview.buffer.slice(0, expectedLength);

  while (source.length < expectedLength) {
    source.push(0);
  }

  const buffer = Buffer.from(source);

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
  const globalScope = globalThis as typeof globalThis & {
    [key]?: PreviewStreamState;
  };

  globalScope[key] ??= {
    clients: new Set(),
    attachedServers: new WeakSet(),
    previewFrameListeners: new Set()
  };

  return globalScope[key];
}
