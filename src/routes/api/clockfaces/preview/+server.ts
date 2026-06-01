import { json, type RequestHandler } from '@sveltejs/kit';
import { getActiveClockfacePreview } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface preview error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async () => {
  try {
    return json({
      ok: true,
      ...(await getActiveClockfacePreview())
    });
  } catch (error) {
    return errorResponse(error);
  }
};
