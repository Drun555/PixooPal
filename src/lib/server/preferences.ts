import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getDataPath } from './dataDir';

type PixooPalPreferences = {
  favoriteClockfaceId?: string;
};

const PREFERENCES_FILE = getDataPath('.pixoopal-settings.json');

export function getFavoriteClockfaceId() {
  return normalizeClockfaceId(readPreferencesFile().favoriteClockfaceId);
}

export function setFavoriteClockfaceId(id: string | null) {
  const preferences = readPreferencesFile();
  const favoriteClockfaceId = normalizeClockfaceId(id);

  if (favoriteClockfaceId) {
    preferences.favoriteClockfaceId = favoriteClockfaceId;
  } else {
    delete preferences.favoriteClockfaceId;
  }

  writePreferencesFile(preferences);
}

function readPreferencesFile(): PixooPalPreferences {
  if (!existsSync(PREFERENCES_FILE)) {
    return {};
  }

  try {
    const value = JSON.parse(readFileSync(PREFERENCES_FILE, 'utf-8')) as unknown;
    return isRecord(value) ? { ...value } : {};
  } catch {
    return {};
  }
}

function writePreferencesFile(preferences: PixooPalPreferences) {
  writeFileSync(PREFERENCES_FILE, `${JSON.stringify(preferences, null, 2)}\n`, 'utf-8');
}

function normalizeClockfaceId(id: unknown) {
  return typeof id === 'string' ? id.trim().replace(/[^\w-]/g, '') : undefined;
}

function isRecord(value: unknown): value is PixooPalPreferences {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
