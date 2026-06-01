import packageJson from '../package.json' with { type: 'json' };

const SUPERVISOR_DISCOVERY_URL = 'http://supervisor/discovery';
const SUPERVISOR_DISCOVERY_SERVICE = 'pixoopal';

export async function registerSupervisorDiscovery(port) {
  const token = process.env.SUPERVISOR_TOKEN;

  if (!token) {
    console.log('[PixooPal] Home Assistant Supervisor discovery skipped: SUPERVISOR_TOKEN is not set.');
    return;
  }

  const payload = {
    service: SUPERVISOR_DISCOVERY_SERVICE,
    config: {
      name: process.env.PIXOOPAL_INSTANCE_NAME || 'PixooPal',
      port: String(port),
      host: process.env.HOST || '0.0.0.0',
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
