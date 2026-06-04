import { json, type RequestHandler } from '@sveltejs/kit';
import { getRuntimeConfig } from '$lib/server/config';
import {
  refreshActiveClockfaceInBackground,
  setPixooScreenWithServiceClockface,
  showNotification
} from '$lib/server/clockfaces';
import { getPixooRecoveryState, getPixooSettings, setBrightness, setWhiteBalance } from '$lib/server/pixoo';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown Pixoo error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async () => {
  const config = getRuntimeConfig();

  if (!config.pixooHost) {
    return json({
      ok: true,
      reachable: false,
      config,
      settings: null,
      recovery: getPixooRecoveryState(),
      message: 'Pixoo address is not configured.'
    });
  }

  try {
    const settings = await getPixooSettings();

    return json({
      ok: true,
      reachable: true,
      config,
      settings,
      recovery: getPixooRecoveryState()
    });
  } catch (error) {
    return json({
      ok: true,
      reachable: false,
      config,
      settings: null,
      recovery: getPixooRecoveryState(),
      message: error instanceof Error ? error.message : 'Pixoo is not reachable.'
    });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload = await request.json();
    const action = typeof payload.action === 'string' ? payload.action : '';
    let result: unknown;

    if (action === 'brightness') {
      result = await setBrightness(Number(payload.value));
      refreshActiveClockfaceInBackground();
    } else if (action === 'whiteBalance') {
      result = await setWhiteBalance(Number(payload.red), Number(payload.green), Number(payload.blue));
      refreshActiveClockfaceInBackground();
    } else if (action === 'screen') {
      result = await setPixooScreenWithServiceClockface(Boolean(payload.on));
    } else if (action === 'notify') {
      result = await showNotification(String(payload.text ?? ''), Boolean(payload.beep));
    } else {
      return errorResponse(new Error('Unsupported Pixoo action.'), 400);
    }

    return json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
};
