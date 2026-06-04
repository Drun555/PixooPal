import { json, type RequestHandler } from '@sveltejs/kit';
import { getBenchmarkInfo, runBenchmark } from '$lib/server/benchmark';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown benchmark error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = () => {
  return json(getBenchmarkInfo());
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json().catch(() => ({}));
    return json(await runBenchmark(payload));
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Benchmark is already running.' ? 409 : 500;
    return errorResponse(error, status);
  }
};
