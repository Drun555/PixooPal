import { json, type RequestHandler } from '@sveltejs/kit';
import { getClockfacesView } from '$lib/server/clockfaces';
import { getPixooPalControlState } from '$lib/server/control';
import { getRuntimeConfig } from '$lib/server/config';
import { getPixooRecoveryState, getPixooSettings } from '$lib/server/pixoo';
import { publishPixooPalEvent } from '$lib/server/previewStream';

export const GET: RequestHandler = async () => {
  const config = getRuntimeConfig();
  const clockfaces = await getClockfacesView();
  const control = getPixooPalControlState();

  if (!config.pixooHost) {
    console.warn('[PixooPal] Status requested without Pixoo host configured.');

    const body = {
      ok: true,
      reachable: false,
      config,
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
    console.warn(
      `[PixooPal] Pixoo status check failed for ${config.pixooHost}: ${error instanceof Error ? error.message : 'Pixoo is not reachable.'}`
    );

    const body = {
      ok: true,
      reachable: false,
      config,
      settings: null,
      control,
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
