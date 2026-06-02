import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  ClockfaceData,
  ClockfacePersistedState,
  ClockfacePersistenceStore
} from '@pixoopal/clockface';
import { getDataPath } from './dataDir';

type PersistedClockfaceEntry = {
  data?: ClockfaceData;
  state?: ClockfacePersistedState;
};

type PersistedClockfacesFile = Record<string, PersistedClockfaceEntry>;

const PERSISTENCE_FILE = getDataPath('.pixoopal-clockfaces.json');

export const fileClockfacePersistenceStore: ClockfacePersistenceStore = {
  read(key) {
    const file = readPersistenceFile();
    const entry = file[key] ?? {};

    return {
      data: sanitizeData(entry.data),
      state: sanitizeState(entry.state)
    };
  },
  write(key, entry) {
    const file = readPersistenceFile();
    file[key] = {
      data: { ...entry.data },
      state: { ...entry.state }
    };

    writeFileSync(PERSISTENCE_FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  }
};

function readPersistenceFile(): PersistedClockfacesFile {
  if (!existsSync(PERSISTENCE_FILE)) {
    return {};
  }

  try {
    const value = JSON.parse(readFileSync(PERSISTENCE_FILE, 'utf-8')) as unknown;
    return isRecord(value) ? (value as PersistedClockfacesFile) : {};
  } catch {
    return {};
  }
}

function sanitizeData(value: unknown): ClockfaceData {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function sanitizeState(value: unknown): ClockfacePersistedState {
  return isRecord(value) ? { ...value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
