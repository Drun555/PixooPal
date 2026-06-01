import type { RequestHandler } from '@sveltejs/kit';
import { getLatestPreviewJpeg } from '$lib/server/previewStream';

export const GET: RequestHandler = async () =>
  new Response(new Uint8Array(await getLatestPreviewJpeg()), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'image/jpeg'
    }
  });
