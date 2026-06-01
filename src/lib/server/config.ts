import { env } from '$env/dynamic/private';

export type RuntimeConfig = {
  pixooAddress: string;
  pixooHost: string;
  pixooPostUrl: string;
  webuiPort: string;
};

let runtimePixooAddress = '';

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

export function getRuntimeConfig(): RuntimeConfig {
  const pixooAddress = runtimePixooAddress || env.PIXOO_DEVICE_ADDRESS || env.PIXOO_ADDRESS || '';
  const pixooHost = normalizePixooHost(pixooAddress);

  return {
    pixooAddress,
    pixooHost,
    pixooPostUrl: pixooHost ? `http://${pixooHost}/post` : '',
    webuiPort: env.PORT ?? ''
  };
}

export function setRuntimePixooAddress(address: string) {
  runtimePixooAddress = normalizePixooHost(address);
  return getRuntimeConfig();
}

export function requirePixooHost() {
  const config = getRuntimeConfig();

  if (!config.pixooHost) {
    throw new Error('Pixoo address is not configured. Start the server with --device <address>.');
  }

  return config;
}
