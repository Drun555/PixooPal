import { json, type RequestHandler } from '@sveltejs/kit';
import { runClockfaceBenchmark } from '$lib/server/benchmark';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface benchmark error';
  return json({ ok: false, message }, { status });
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json().catch(() => ({}));
    return json(await runClockfaceBenchmark(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message.includes('already running') ? 409 : message ? 400 : 500;
    return errorResponse(error, status);
  }
};
