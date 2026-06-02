import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');

export function getDataDir() {
  ensureDataDir();
  return DATA_DIR;
}

export function getDataPath(...parts: string[]) {
  return join(getDataDir(), ...parts);
}

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}
