import { json, type RequestHandler } from '@sveltejs/kit';
import { getPixooPalControlState, setPixooPalOff } from '$lib/server/control';

export function GET() {
  return json({
    ok: true,
    control: getPixooPalControlState()
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const payload = await request.json().catch(() => ({}));
  const pixooPalOff = isRecord(payload) && payload.pixooPalOff === true;

  return json({
    ok: true,
    control: setPixooPalOff(pixooPalOff)
  });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
