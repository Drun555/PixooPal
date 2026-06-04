import { json, type RequestHandler } from '@sveltejs/kit';
import { renderJinja } from '$lib/server/homeAssistant';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown Home Assistant template error';
  return json({ ok: false, message }, { status });
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();

    if (!isRecord(payload) || typeof payload.template !== 'string') {
      return errorResponse(new Error('Template is required.'), 400);
    }

    const variables = isRecord(payload.variables) ? payload.variables : {};

    return json({
      ok: true,
      result: await renderJinja(payload.template, variables)
    });
  } catch (error) {
    return errorResponse(error);
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
