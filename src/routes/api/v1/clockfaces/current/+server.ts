import { json, type RequestHandler } from '@sveltejs/kit';
import { getClockfacesView, setActiveClockface } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async () => {
  try {
    const view = await getClockfacesView();

    return json({
      ok: true,
      activeId: view.activeId,
      clockface: view.active
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();

    return json({
      ok: true,
      ...(await setActiveClockface(String(payload.id ?? '')))
    });
  } catch (error) {
    return errorResponse(error);
  }
};
