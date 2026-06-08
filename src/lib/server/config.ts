import { env } from '$env/dynamic/private';

export type RuntimeConfig = {
  configured: boolean;
  homeAssistantConfigured: boolean;
  homeAssistantTokenConfigured: boolean;
  homeAssistantUrl: string;
  pixooAddress: string;
  pixooHost: string;
  pixooPostUrl: string;
  webuiPort: string;
};

let runtimePixooAddress = '';
let lastLoggedRuntimeConfigSignature = '';

export function normalizePixooHost(address: string) {
  const value = address.trim();

  if (!value) {
    return '';
  }

  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    return url.host;
  }

  return value.replace(/\/post\/?$/i, '').replace(/\/$/, '');
}

export function normalizeHomeAssistantUrl(address: string) {
  const value = address.trim();

  if (!value) {
    return '';
  }

  let url: URL;

  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    return '';
  }

  if (!url.port) {
    url.port = '8123';
  }

  return `${url.protocol}//${url.host}`;
}

export function getRuntimeConfig(): RuntimeConfig {
  const pixooAddress = runtimePixooAddress || env.PIXOO_DEVICE_ADDRESS || env.PIXOO_ADDRESS || '';
  const pixooHost = normalizePixooHost(pixooAddress);
  const supervisorTokenConfigured = Boolean(env.SUPERVISOR_TOKEN);
  const homeAssistantTokenConfigured = supervisorTokenConfigured || Boolean(env.HOME_ASSISTANT_TOKEN);
  const homeAssistantUrl = supervisorTokenConfigured
    ? 'http://supervisor/core'
    : normalizeHomeAssistantUrl(env.HOME_ASSISTANT_URL || env.HOME_ASSISTANT_ADDRESS || '');
  const config = {
    configured: Boolean(pixooHost),
    homeAssistantConfigured: Boolean(homeAssistantUrl && homeAssistantTokenConfigured),
    homeAssistantTokenConfigured,
    homeAssistantUrl,
    pixooAddress,
    pixooHost,
    pixooPostUrl: pixooHost ? `http://${pixooHost}/post` : '',
    webuiPort: env.PORT ?? ''
  };

  logRuntimeConfig(config);

  return config;
}

export function setRuntimePixooAddress(address: string) {
  const previousAddress = runtimePixooAddress;
  runtimePixooAddress = normalizePixooHost(address);

  console.log(
    `[PixooPal] Runtime Pixoo address updated via API: input=${address || '(empty)'}, normalized=${runtimePixooAddress || '(empty)'}, previous=${previousAddress || '(empty)'}`
  );

  return getRuntimeConfig();
}

export function requirePixooHost() {
  const config = getRuntimeConfig();

  if (!config.pixooHost) {
    throw new Error('Pixoo address is not configured. Start the server with --device <address>.');
  }

  return config;
}

function logRuntimeConfig(config: RuntimeConfig) {
  const source = runtimePixooAddress
    ? 'runtime'
    : env.PIXOO_DEVICE_ADDRESS
      ? 'PIXOO_DEVICE_ADDRESS'
      : env.PIXOO_ADDRESS
        ? 'PIXOO_ADDRESS'
        : 'empty';
  const signature = `${source}|${config.pixooHost}|${config.webuiPort}|${config.homeAssistantUrl}|${config.homeAssistantTokenConfigured}`;

  if (signature === lastLoggedRuntimeConfigSignature) {
    return;
  }

  lastLoggedRuntimeConfigSignature = signature;
  console.log(
    `[PixooPal] Runtime config resolved: source=${source}, pixooHost=${config.pixooHost || '(empty)'}, webuiPort=${config.webuiPort || '(empty)'}, homeAssistantUrl=${config.homeAssistantUrl || '(empty)'}, homeAssistantToken=${config.homeAssistantTokenConfigured ? 'set' : 'empty'}`
  );
}
