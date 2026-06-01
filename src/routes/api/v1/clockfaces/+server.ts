import { json, type RequestHandler } from '@sveltejs/kit';
import { getClockfacesView } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async () => {
  try {
    return json({
      ok: true,
      ...(await getClockfacesView())
    });
  } catch (error) {
    return errorResponse(error);
  }
};
