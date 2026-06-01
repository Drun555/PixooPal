import { json, type RequestHandler } from '@sveltejs/kit';
import { showNotification } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown notification error';
  return json({ ok: false, message }, { status });
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();

    return json({
      ok: true,
      ...(await showNotification(String(payload.message ?? ''), Boolean(payload.beep)))
    });
  } catch (error) {
    return errorResponse(error);
  }
};
