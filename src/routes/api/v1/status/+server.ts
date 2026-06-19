import { json, type RequestHandler } from '@sveltejs/kit';
import { getClockfacesView } from '$lib/server/clockfaces';
import { getPixooPalControlState } from '$lib/server/control';
import { getRuntimeConfig } from '$lib/server/config';
import { getHomeAssistantStatus } from '$lib/server/homeAssistant';
import { getPixooRecoveryState, getPixooSettings } from '$lib/server/pixoo';
import { publishPixooPalEvent } from '$lib/server/previewStream';

const PIXOO_UNREACHABLE_MESSAGE = 'Pixoo is unreachable.';

export const GET: RequestHandler = async () => {
  const config = getRuntimeConfig();
  const clockfaces = await getClockfacesView();
  const control = getPixooPalControlState();
  const homeAssistant = await getHomeAssistantStatus();

  if (!config.pixooHost) {
    console.warn('[PixooPal] Status requested without Pixoo host configured.');

    const body = {
      ok: true,
      reachable: false,
      config,
      homeAssistant,
      settings: null,
      control,
      recovery: getPixooRecoveryState(),
      activeClockface: clockfaces.active,
      message: 'Pixoo address is not configured.'
    };

    publishPixooPalEvent({
      type: 'device_status',
      reachable: body.reachable,
      status: body
    });

    return json(body);
  }

  try {
    const settings = await getPixooSettings();
    const body = {
      ok: true,
      reachable: true,
      config,
      homeAssistant,
      settings,
      control,
      recovery: getPixooRecoveryState(),
      activeClockface: clockfaces.active
    };

    publishPixooPalEvent({
      type: 'device_status',
      reachable: body.reachable,
      status: body
    });

    return json(body);
  } catch (error) {
    const message = getPixooStatusErrorMessage(error);
    const body = {
      ok: false,
      reachable: false,
      config,
      homeAssistant,
      settings: null,
      control,
      recovery: getPixooRecoveryState(),
      activeClockface: clockfaces.active,
      message
    };

    publishPixooPalEvent({
      type: 'device_status',
      reachable: body.reachable,
      status: body
    });

    return json(body, { status: 503 });
  }
};

function getPixooStatusErrorMessage(error: unknown) {
  if (isAbortError(error)) {
    return PIXOO_UNREACHABLE_MESSAGE;
  }

  const message = error instanceof Error ? error.message : '';

  if (!message || message === 'This operation was aborted' || message === 'fetch failed') {
    return PIXOO_UNREACHABLE_MESSAGE;
  }

  return message;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted');
}
