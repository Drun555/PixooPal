import { json, type RequestHandler } from '@sveltejs/kit';
import { getActiveClockfacePreview } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface preview error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async () => {
  try {
    const preview = await getActiveClockfacePreview();

    return json({
      ok: true,
      ...preview,
      preview: {
        ...preview.preview,
        buffer: Array.from(preview.preview.buffer)
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
};
