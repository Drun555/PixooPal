import { json, type RequestHandler } from '@sveltejs/kit';
import {
  getHomeAssistantConnectionState,
  registerHomeAssistantConnection
} from '$lib/server/homeAssistant';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown Home Assistant handshake error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = () => {
  return json({
    ok: true,
    ...getHomeAssistantConnectionState()
  });
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return errorResponse(new Error('Handshake payload must be an object.'), 400);
    }

    return json({
      ok: true,
      ...registerHomeAssistantConnection({
        entryId: String(payload.entryId ?? ''),
        renderPath: String(payload.renderPath ?? ''),
        renderUrl: typeof payload.renderUrl === 'string' ? payload.renderUrl : undefined
      })
    });
  } catch (error) {
    return errorResponse(error);
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
