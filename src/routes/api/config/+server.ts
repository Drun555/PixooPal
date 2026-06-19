import { json, type RequestHandler } from '@sveltejs/kit';
import { getRuntimeConfig, setRuntimePixooAddress } from '$lib/server/config';

export function GET() {
  const config = getRuntimeConfig();

  console.log(
    `[PixooPal] API config GET: pixooHost=${config.pixooHost || '(empty)'}, webuiPort=${config.webuiPort || '(empty)'}, resolution=${config.resolution}`
  );

  return json({
    ok: true,
    config
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const payload = await request.json().catch(() => ({}));
  const pixooAddress = typeof payload.pixooAddress === 'string' ? payload.pixooAddress : '';

  console.log(
    `[PixooPal] API config POST: received pixooAddress=${pixooAddress || '(empty)'}`
  );

  const config = setRuntimePixooAddress(pixooAddress);

  return json({
    ok: true,
    config
  });
};
