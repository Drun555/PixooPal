import { json, type RequestHandler } from '@sveltejs/kit';
import { getClockfacesView } from '$lib/server/clockfaces';
import { getPixooPalControlState } from '$lib/server/control';
import { getRuntimeConfig } from '$lib/server/config';
import { getCachedPixooSettings, getPixooRecoveryState } from '$lib/server/pixoo';
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

  const recovery = getPixooRecoveryState();
  const body = {
    ok: true,
    reachable: recovery.reachable,
    config,
    settings: getCachedPixooSettings(),
    control,
    recovery,
    activeClockface: clockfaces.active,
    message: recovery.reachable ? undefined : 'Pixoo reachability has not been confirmed yet.'
  };

  publishPixooPalEvent({
    type: 'device_status',
    reachable: body.reachable,
    status: body
  });

  return json(body);
};
