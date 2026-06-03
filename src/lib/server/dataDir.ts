import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function resolveDataDir() {
  return resolve(process.cwd(), 'data');
}

export function getDataDir() {
  ensureDataDir();
  return resolveDataDir();
}

export function getDataPath(...parts: string[]) {
  return resolve(getDataDir(), ...parts);
}

export function ensureDataDir() {
  mkdirSync(resolveDataDir(), { recursive: true });
}
