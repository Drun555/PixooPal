import packageJson from '../package.json' with { type: 'json' };

const SUPERVISOR_DISCOVERY_URL = 'http://supervisor/discovery';
const SUPERVISOR_ADDON_INFO_URL = 'http://supervisor/addons/self/info';
const SUPERVISOR_DISCOVERY_SERVICE = 'pixoopal';

export async function registerSupervisorDiscovery(port) {
  const token = process.env.SUPERVISOR_TOKEN;

  if (!token) {
    console.log('[PixooPal] Home Assistant Supervisor discovery skipped: SUPERVISOR_TOKEN is not set.');
    return;
  }

  const host = await getSupervisorAddonHost(token);

  const payload = {
    service: SUPERVISOR_DISCOVERY_SERVICE,
    config: {
      name: process.env.PIXOOPAL_INSTANCE_NAME || 'PixooPal',
      port: String(port),
      host,
      path: '/api/v1/discovery',
      status_path: '/api/v1/status',
      version: packageJson.version,
      api_version: 1
    }
  };

  try {
    const response = await fetch(SUPERVISOR_DISCOVERY_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const bodyText = await response.text();

    if (!response.ok) {
      console.warn(
        `[PixooPal] Home Assistant Supervisor discovery failed: HTTP ${response.status} ${bodyText}`
      );
      return;
    }

    console.log(`[PixooPal] Home Assistant Supervisor discovery registered: ${bodyText || '{}'}`);
  } catch (error) {
    console.warn('[PixooPal] Home Assistant Supervisor discovery failed:', error);
  }
}

async function getSupervisorAddonHost(token) {
  const configuredHost = process.env.PIXOOPAL_DISCOVERY_HOST?.trim();

  if (configuredHost) {
    return configuredHost;
  }

  try {
    const response = await fetch(SUPERVISOR_ADDON_INFO_URL, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const body = await response.json();
    const hostname = body?.data?.hostname || body?.hostname;

    if (response.ok && typeof hostname === 'string' && hostname.trim()) {
      return hostname.trim();
    }

    console.warn(
      `[PixooPal] Could not read add-on hostname from Supervisor: HTTP ${response.status}`
    );
  } catch (error) {
    console.warn('[PixooPal] Could not read add-on hostname from Supervisor:', error);
  }

  return 'local-pixoopal';
}
