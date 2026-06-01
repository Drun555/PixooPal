import { env } from '$env/dynamic/private';

export type RuntimeConfig = {
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

export function getRuntimeConfig(): RuntimeConfig {
  const pixooAddress = runtimePixooAddress || env.PIXOO_DEVICE_ADDRESS || env.PIXOO_ADDRESS || '';
  const pixooHost = normalizePixooHost(pixooAddress);
  const config = {
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
  const signature = `${source}|${config.pixooHost}|${config.webuiPort}`;

  if (signature === lastLoggedRuntimeConfigSignature) {
    return;
  }

  lastLoggedRuntimeConfigSignature = signature;
  console.log(
    `[PixooPal] Runtime config resolved: source=${source}, pixooHost=${config.pixooHost || '(empty)'}, webuiPort=${config.webuiPort || '(empty)'}`
  );
}
