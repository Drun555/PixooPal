import type { RequestHandler } from '@sveltejs/kit';
import { divoomJson, divoomOptions } from '$lib/server/divoomHttp';

export function GET() {
  console.log('[PixooPal MITM] Pixoo reached /Test/GetIP. Replying with local IP stub.');

  return divoomJson({
    ReturnCode: 0,
    ReturnMessage: '',
    CustonIP: '80.92.211.126'
  });
}

export const OPTIONS: RequestHandler = async () => divoomOptions();
