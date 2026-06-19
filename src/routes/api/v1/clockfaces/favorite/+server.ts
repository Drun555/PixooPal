import { json, type RequestHandler } from '@sveltejs/kit';
import { setFavoriteClockface } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface favorite error';
  return json({ ok: false, message }, { status });
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();
    const id = payload.id === null ? null : String(payload.id ?? '');

    return json({
      ok: true,
      ...(await setFavoriteClockface(id))
    });
  } catch (error) {
    return errorResponse(error);
  }
};
