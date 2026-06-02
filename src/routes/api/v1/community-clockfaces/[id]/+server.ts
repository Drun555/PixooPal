import { json, type RequestHandler } from '@sveltejs/kit';
import {
  deleteCommunityClockface,
  getCommunityClockfaceDetail,
  getCommunityClockfacesCatalog
} from '$lib/server/communityClockfaces';
import { refreshCommunityClockfaces } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown community clockface error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async ({ params }) => {
  try {
    return json({
      ok: true,
      clockface: await getCommunityClockfaceDetail(params.id ?? '')
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    await deleteCommunityClockface(params.id ?? '');
    await refreshCommunityClockfaces();

    return json({
      ok: true,
      clockfaces: await getCommunityClockfacesCatalog()
    });
  } catch (error) {
    return errorResponse(error);
  }
};
