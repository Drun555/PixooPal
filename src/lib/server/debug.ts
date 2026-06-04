const DEBUG_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isDebugLoggingEnabled() {
  return DEBUG_TRUE_VALUES.has((process.env.DEBUG_LOGGING ?? '').trim().toLowerCase());
}

export function debugLog(message: string, details?: Record<string, unknown>) {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  if (details) {
    console.log(`[PixooPal debug] ${message}`, details);
    return;
  }

  console.log(`[PixooPal debug] ${message}`);
}
