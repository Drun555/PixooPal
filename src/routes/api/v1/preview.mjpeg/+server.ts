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

export const GET: RequestHandler = async () => {
  let closed = false;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendFrame = async (frame: PreviewFrame) => {
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

      sendFrame(getLatestPreviewFrame() ?? getEmptyPreviewFrame());
      unsubscribe = subscribePreviewFrames(sendFrame);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    }
  });

  return new Response(stream, {
    headers: {
      'cache-control': 'no-store',
      'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`
    }
  });
};
