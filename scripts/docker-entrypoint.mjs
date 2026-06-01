import { existsSync, readFileSync } from 'node:fs';

const OPTIONS_PATH = '/data/options.json';

process.env.HOST ??= '0.0.0.0';
process.env.PORT ||= '5173';
process.env.PIXOOPAL_DATA_DIR ||= '/data';

if (existsSync(OPTIONS_PATH)) {
  const options = readOptions(OPTIONS_PATH);
  const pixooAddress = normalizeOption(options.pixoo_device_address);

  if (pixooAddress) {
    process.env.PIXOO_DEVICE_ADDRESS = pixooAddress;
  }
}

await import('./server.mjs');

function readOptions(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    console.warn(`Could not read Home Assistant options from ${path}:`, error);
    return {};
  }
}

function normalizeOption(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
