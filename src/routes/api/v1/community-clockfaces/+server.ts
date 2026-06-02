import { json, type RequestHandler } from '@sveltejs/kit';
import {
  getCommunityClockfacesCatalog,
  installCommunityClockface
} from '$lib/server/communityClockfaces';
import { refreshCommunityClockfaces } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown community clockface error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async () => {
  try {
    return json({
      ok: true,
      clockfaces: await getCommunityClockfacesCatalog()
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();
    const clockface = await installCommunityClockface(String(payload.id ?? ''));
    await refreshCommunityClockfaces();

    return json({
      ok: true,
      clockface,
      clockfaces: await getCommunityClockfacesCatalog()
    });
  } catch (error) {
    return errorResponse(error);
  }
};
