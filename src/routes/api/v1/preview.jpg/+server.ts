import type { RequestHandler } from '@sveltejs/kit';
import { refreshActiveClockfacePreview } from '$lib/server/clockfaces';
import { getLatestPreviewJpeg, previewPayloadToJpeg } from '$lib/server/previewStream';

export const GET: RequestHandler = async () => {
  let jpeg: Buffer;

  try {
    const frame = await refreshActiveClockfacePreview();
    jpeg = await previewPayloadToJpeg(frame.preview);
  } catch {
    jpeg = await getLatestPreviewJpeg();
  }

  return new Response(new Uint8Array(jpeg), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'image/jpeg'
    }
  });
};
