import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import packageJson from '../../../package.json';
import { getRuntimeConfig } from './config';
import { getDataPath } from './dataDir';

const INSTANCE_FILE = getDataPath('.pixoopal-instance.json');

const API_VERSION = 1;
const ZEROCONF_TYPE = '_pixoopal._tcp.local.';

type InstanceState = {
  id: string;
  name: string;
};

let instanceState: InstanceState | null = null;

export function getPixooPalDiscoveryInfo(origin?: string) {
  const instance = getInstanceState();
  const config = getRuntimeConfig();
  const port = Number.parseInt(env.PORT ?? '5173', 10);
  const baseUrl = origin || '';

  return {
    ok: true,
    id: instance.id,
    name: instance.name,
    manufacturer: 'PixooPal',
    model: 'PixooPal',
    sw_version: packageJson.version,
    api_version: API_VERSION,
    zeroconf: {
      type: ZEROCONF_TYPE,
      port,
      txt: {
        id: instance.id,
        name: instance.name,
        version: packageJson.version,
        api: String(API_VERSION),
        path: '/api/v1/discovery',
        status: '/api/v1/status'
      }
    },
    urls: {
      base: baseUrl,
      api: `${baseUrl}/api/v1`,
      discovery: `${baseUrl}/api/v1/discovery`,
      status: `${baseUrl}/api/v1/status`,
      preview: `${baseUrl}/api/v1/preview.jpg`,
      events: `${baseUrl.replace(/^http/i, 'ws')}/api/v1/events`
    },
    pixoo: {
      configured: config.configured,
      host: config.pixooHost
    }
  };
}

function getInstanceState(): InstanceState {
  if (instanceState) {
    return instanceState;
  }

  instanceState = readInstanceState();
  return instanceState;
}

function readInstanceState(): InstanceState {
  const envName = getInstanceName('');

  if (existsSync(INSTANCE_FILE)) {
    try {
      const value = JSON.parse(readFileSync(INSTANCE_FILE, 'utf-8')) as unknown;

      if (isRecord(value) && typeof value.id === 'string' && value.id) {
        const state = {
          id: value.id,
          name: getInstanceName(typeof value.name === 'string' ? value.name : '')
        };

        if (state.name !== value.name) {
          writeInstanceState(state);
        }

        return state;
      }
    } catch (error) {
      console.warn(`Could not read PixooPal instance state from ${INSTANCE_FILE}:`, error);
    }
  }

  const state = {
    id: randomUUID(),
    name: envName || 'PixooPal'
  };

  writeInstanceState(state);
  return state;
}

function writeInstanceState(state: InstanceState) {
  writeFileSync(INSTANCE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function getInstanceName(storedName: string) {
  return (env.PIXOOPAL_INSTANCE_NAME || storedName || 'PixooPal').trim() || 'PixooPal';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
