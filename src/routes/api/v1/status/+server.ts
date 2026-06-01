import { json, type RequestHandler } from '@sveltejs/kit';
import { getClockfacesView } from '$lib/server/clockfaces';
import { getRuntimeConfig } from '$lib/server/config';
import { getPixooRecoveryState, getPixooSettings } from '$lib/server/pixoo';
import { publishPixooPalEvent } from '$lib/server/previewStream';

export const GET: RequestHandler = async () => {
  const config = getRuntimeConfig();
  const clockfaces = await getClockfacesView();

  if (!config.pixooHost) {
    console.warn('[PixooPal] Status requested without Pixoo host configured.');

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
    console.log(`[PixooPal] Pixoo status check succeeded for ${config.pixooHost}.`);

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
    console.warn(
      `[PixooPal] Pixoo status check failed for ${config.pixooHost}: ${error instanceof Error ? error.message : 'Pixoo is not reachable.'}`
    );

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
