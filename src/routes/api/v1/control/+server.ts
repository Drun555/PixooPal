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
  const control = setPixooPalOff(pixooPalOff);

  return json({
    ok: true,
    control
  });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
