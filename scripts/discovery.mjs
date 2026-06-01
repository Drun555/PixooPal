import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Bonjour from 'bonjour-service';
import packageJson from '../package.json' with { type: 'json' };

const API_VERSION = 1;

export function advertisePixooPal(port) {
  if (isDisabled()) {
    console.log('[PixooPal] Zeroconf discovery is disabled by PIXOOPAL_DISABLE_MDNS.');
    return () => {};
  }

  const instance = getInstanceState();
  const bonjour = new Bonjour(undefined, (error) => {
    console.warn('[PixooPal] Zeroconf discovery error:', error);
  });
  const service = bonjour.publish({
    name: instance.name,
    type: 'pixoopal',
    protocol: 'tcp',
    port,
    txt: {
      id: instance.id,
      name: instance.name,
      version: packageJson.version,
      api: String(API_VERSION),
      path: '/api/v1/discovery',
      status: '/api/v1/status'
    }
  });

  console.log(
    `[PixooPal] Zeroconf discovery published: ${instance.name} (_pixoopal._tcp.local.) on port ${port}`
  );

  return () => {
    try {
      service.stop(() => bonjour.destroy());
    } catch (error) {
      console.warn('[PixooPal] Could not stop Zeroconf discovery:', error);
    }
  };
}

function getInstanceState() {
  const file = getInstanceFile();
  const envName = getInstanceName('');

  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, 'utf-8'));

      if (value && typeof value === 'object' && typeof value.id === 'string' && value.id) {
        const state = {
          id: value.id,
          name: getInstanceName(typeof value.name === 'string' ? value.name : '')
        };

        if (state.name !== value.name) {
          writeInstanceState(file, state);
        }

        return state;
      }
    } catch (error) {
      console.warn(`Could not read PixooPal instance state from ${file}:`, error);
    }
  }

  const state = {
    id: randomUUID(),
    name: envName || 'PixooPal'
  };

  writeInstanceState(file, state);
  return state;
}

function writeInstanceState(file, state) {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function getInstanceFile() {
  return join(
    process.env.PIXOOPAL_DATA_DIR || (existsSync('/data') ? '/data' : process.cwd()),
    '.pixoopal-instance.json'
  );
}

function getInstanceName(storedName) {
  return (process.env.PIXOOPAL_INSTANCE_NAME || storedName || 'PixooPal').trim() || 'PixooPal';
}

function isDisabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.PIXOOPAL_DISABLE_MDNS || '').trim().toLowerCase()
  );
}
