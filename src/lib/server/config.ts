import { env } from '$env/dynamic/private';

export type RuntimeConfig = {
  configured: boolean;
  homeAssistantConfigured: boolean;
  homeAssistantTokenConfigured: boolean;
  homeAssistantUrl: string;
  pixooAddress: string;
  pixooHost: string;
  pixooPostUrl: string;
  resolution: RuntimeResolution;
  webuiPort: string;
  webuiHttpsPort: string;
};

export type RuntimeResolution = 16 | 32 | 64;

const DEFAULT_RESOLUTION: RuntimeResolution = 64;
const SUPPORTED_RESOLUTIONS = [16, 32, 64] as const;

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
  const resolution = getRuntimeResolution();
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
    resolution,
    webuiPort: env.HTTP_PORT ?? env.PORT ?? '',
    webuiHttpsPort: env.HTTPS_PORT ?? ''
  };

  logRuntimeConfig(config);

  return config;
}

export function getRuntimeResolution() {
  return normalizeRuntimeResolution(env.RESOLUTION);
}

export function normalizeRuntimeResolution(value: unknown): RuntimeResolution {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  return SUPPORTED_RESOLUTIONS.find((resolution) => resolution === parsed) ?? DEFAULT_RESOLUTION;
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
  const signature = `${source}|${config.pixooHost}|${config.webuiPort}|${config.webuiHttpsPort}|${config.resolution}|${config.homeAssistantUrl}|${config.homeAssistantTokenConfigured}`;

  if (signature === lastLoggedRuntimeConfigSignature) {
    return;
  }

  lastLoggedRuntimeConfigSignature = signature;
  console.log(
    `[PixooPal] Runtime config resolved: source=${source}, pixooHost=${config.pixooHost || '(empty)'}, webuiPort=${config.webuiPort || '(empty)'}, webuiHttpsPort=${config.webuiHttpsPort || '(empty)'}, resolution=${config.resolution}, homeAssistantUrl=${config.homeAssistantUrl || '(empty)'}, homeAssistantToken=${config.homeAssistantTokenConfigured ? 'set' : 'empty'}`
  );
}
