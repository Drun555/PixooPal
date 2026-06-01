import { json, type RequestHandler } from '@sveltejs/kit';
import { getRuntimeConfig, setRuntimePixooAddress } from '$lib/server/config';

export function GET() {
  return json({
    ok: true,
    config: getRuntimeConfig()
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const payload = await request.json().catch(() => ({}));
  const pixooAddress = typeof payload.pixooAddress === 'string' ? payload.pixooAddress : '';
  const config = setRuntimePixooAddress(pixooAddress);

  return json({
    ok: true,
    config
  });
};
