import { json, type RequestHandler } from '@sveltejs/kit';
import { getRuntimeConfig } from '$lib/server/config';
import {
  refreshActiveClockfaceInBackground,
  setPixooScreenWithServiceClockface,
  showNotification
} from '$lib/server/clockfaces';
import {
  clearScreen,
  drawCenteredText,
  fillScreen,
  getEmptyPreviewBuffer,
  getPreviewBuffer,
  getPixooRecoveryState,
  getPixooSettings,
  parseHexColor,
  setBrightness
} from '$lib/server/pixoo';

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
      preview: getEmptyPreviewBuffer(),
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
      recovery: getPixooRecoveryState(),
      preview: getPreviewBuffer()
    });
  } catch (error) {
    return json({
      ok: true,
      reachable: false,
      config,
      settings: null,
      recovery: getPixooRecoveryState(),
      preview: getEmptyPreviewBuffer(),
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
    } else if (action === 'screen') {
      result = await setPixooScreenWithServiceClockface(Boolean(payload.on));
    } else if (action === 'fill') {
      result = await fillScreen(parseHexColor(String(payload.color ?? '#000000')));
    } else if (action === 'clear') {
      result = await clearScreen();
    } else if (action === 'text') {
      result = await drawCenteredText(
        String(payload.text ?? ''),
        parseHexColor(String(payload.color ?? '#ffffff'))
      );
    } else if (action === 'notify') {
      result = await showNotification(String(payload.text ?? ''), Boolean(payload.beep));
    } else {
      return errorResponse(new Error('Unsupported Pixoo action.'), 400);
    }

    return json({ ok: true, result, preview: getPreviewBuffer() });
  } catch (error) {
    return errorResponse(error);
  }
};
