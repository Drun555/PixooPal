import { json, type RequestHandler } from '@sveltejs/kit';
import { getClockfacesView } from '$lib/server/clockfaces';
import { getRuntimeConfig } from '$lib/server/config';
import { getPixooRecoveryState, getPixooSettings } from '$lib/server/pixoo';
import { publishPixooPalEvent } from '$lib/server/previewStream';

export const GET: RequestHandler = async () => {
  const config = getRuntimeConfig();
  const clockfaces = await getClockfacesView();

  if (!config.pixooHost) {
    const body = {
      ok: true,
      reachable: false,
      config,
      settings: null,
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
      settings,
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
    const body = {
      ok: true,
      reachable: false,
      config,
      settings: null,
      recovery: getPixooRecoveryState(),
      activeClockface: clockfaces.active,
      message: error instanceof Error ? error.message : 'Pixoo is not reachable.'
    };

    publishPixooPalEvent({
      type: 'device_status',
      reachable: body.reachable,
      status: body
    });

    return json(body);
  }
};
