import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync
} from 'node:fs';

const OPTIONS_PATH = '/data/options.json';
const PROJECT_DATA_PATH = `${process.cwd()}/data`;

process.env.HOST ??= '0.0.0.0';
process.env.PORT ||= '5173';

logStartupEnvironment();
linkProjectDataToDockerVolume();

if (existsSync(OPTIONS_PATH)) {
  logOptionsFile(OPTIONS_PATH);
  const options = readOptions(OPTIONS_PATH);
  console.log(
    `[PixooPal] Home Assistant options keys: ${Object.keys(options).sort().join(', ') || '(none)'}`
  );

  const pixooAddress = normalizeOption(
    options.pixoo_device_address ?? options.pixoo_address ?? options.pixoo_host
  );

  if (pixooAddress) {
    process.env.PIXOO_DEVICE_ADDRESS = pixooAddress;
    console.log(`[PixooPal] Pixoo address loaded from Home Assistant options: ${pixooAddress}`);
  } else {
    console.warn(
      '[PixooPal] Home Assistant options did not contain pixoo_device_address, pixoo_address, or pixoo_host.'
    );
  }
} else {
  console.warn(`[PixooPal] Home Assistant options file was not found at ${OPTIONS_PATH}.`);
}

console.log(
  `[PixooPal] Effective configuration before server start: PIXOO_DEVICE_ADDRESS=${process.env.PIXOO_DEVICE_ADDRESS || '(empty)'}, PIXOO_ADDRESS=${process.env.PIXOO_ADDRESS || '(empty)'}, PORT=${process.env.PORT}, HOST=${process.env.HOST}`
);

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

function logStartupEnvironment() {
  console.log(
    `[PixooPal] Starting Docker entrypoint as uid=${typeof process.getuid === 'function' ? process.getuid() : 'unknown'}, gid=${typeof process.getgid === 'function' ? process.getgid() : 'unknown'}`
  );
  console.log(
    `[PixooPal] Runtime env presence: PIXOO_DEVICE_ADDRESS=${process.env.PIXOO_DEVICE_ADDRESS ? 'set' : 'empty'}, PIXOO_ADDRESS=${process.env.PIXOO_ADDRESS ? 'set' : 'empty'}`
  );
}

function linkProjectDataToDockerVolume() {
  mkdirSync('/data', { recursive: true });

  if (existsSync(PROJECT_DATA_PATH)) {
    const stats = lstatSync(PROJECT_DATA_PATH);

    if (stats.isSymbolicLink()) {
      rmSync(PROJECT_DATA_PATH);
    }

    if (!stats.isDirectory()) {
      throw new Error(`[PixooPal] ${PROJECT_DATA_PATH} exists and is not a directory.`);
    }

    cpSync(PROJECT_DATA_PATH, '/data', { recursive: true });
    rmSync(PROJECT_DATA_PATH, { recursive: true, force: true });
  }

  symlinkSync('/data', PROJECT_DATA_PATH, 'dir');
  console.log(`[PixooPal] Linked ${PROJECT_DATA_PATH} to persistent /data volume.`);
}

function logOptionsFile(path) {
  try {
    const stats = statSync(path);
    console.log(
      `[PixooPal] Found Home Assistant options file at ${path}: uid=${stats.uid}, gid=${stats.gid}, mode=${(stats.mode & 0o777).toString(8)}, size=${stats.size}`
    );
  } catch (error) {
    console.warn(`[PixooPal] Could not stat Home Assistant options file at ${path}:`, error);
  }
}
