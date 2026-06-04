import type { RequestHandler } from '@sveltejs/kit';
import { refreshActiveClockfacePreview } from '$lib/server/clockfaces';
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
const IDLE_FRAME_INTERVAL_MS = 1000;

export const GET: RequestHandler = async () => {
  let initialFrame = getLatestPreviewFrame() ?? getEmptyPreviewFrame();

  try {
    initialFrame = await refreshActiveClockfacePreview();
  } catch {
    initialFrame = getLatestPreviewFrame() ?? initialFrame;
  }

  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let lastSentAt = 0;
  let pendingFrame: PreviewFrame | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setInterval> | undefined;

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

      scheduleFrame(initialFrame);
      unsubscribe = subscribePreviewFrames(scheduleFrame);
      idleTimer = setInterval(() => {
        scheduleFrame(getLatestPreviewFrame() ?? initialFrame);
      }, IDLE_FRAME_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      clearTimeout(pendingTimer);
      clearInterval(idleTimer);
      unsubscribe?.();
    }
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, no-transform, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Content-Encoding': 'identity',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  });
};
