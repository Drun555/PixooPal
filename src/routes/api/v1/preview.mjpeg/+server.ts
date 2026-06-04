import type { RequestHandler } from '@sveltejs/kit';
import {
  getEmptyPreviewFrame,
  getLatestPreviewFrame,
  previewPayloadToJpeg,
  subscribePreviewFrames,
  type PreviewFrame
} from '$lib/server/previewStream';

const BOUNDARY = 'pixoopal-preview';
const encoder = new TextEncoder();
const MIN_FRAME_INTERVAL_MS = 100;

export const GET: RequestHandler = async () => {
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let lastSentAt = 0;
  let pendingFrame: PreviewFrame | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendFrame = async (frame: PreviewFrame) => {
        lastSentAt = Date.now();

        try {
          const jpeg = await previewPayloadToJpeg(frame.preview);

          if (closed) {
            return;
          }

          controller.enqueue(
            encoder.encode(
              `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`
            )
          );
          controller.enqueue(jpeg);
          controller.enqueue(encoder.encode('\r\n'));
        } catch (error) {
          console.error('MJPEG frame encode failed:', error);
        }
      };

      const scheduleFrame = (frame: PreviewFrame) => {
        pendingFrame = frame;

        if (closed || pendingTimer) {
          return;
        }

        const remaining = Math.max(0, MIN_FRAME_INTERVAL_MS - (Date.now() - lastSentAt));
        pendingTimer = setTimeout(() => {
          const nextFrame = pendingFrame;
          pendingFrame = undefined;
          pendingTimer = undefined;

          if (!closed && nextFrame) {
            sendFrame(nextFrame);
          }
        }, remaining);
      };

      scheduleFrame(getLatestPreviewFrame() ?? getEmptyPreviewFrame());
      unsubscribe = subscribePreviewFrames(scheduleFrame);
    },
    cancel() {
      closed = true;
      clearTimeout(pendingTimer);
      unsubscribe?.();
    }
  });

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-store, must-revalidate',
      'content-encoding': 'identity',
      'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'pragma': 'no-cache',
      'x-accel-buffering': 'no'
    }
  });
};
