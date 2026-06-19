import { Buffer } from 'node:buffer';

export function parsePayloadJson(payload: Buffer | string | undefined): Record<string, unknown> | null {
  if (!payload) {
    return null;
  }

  try {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf-8') : String(payload);
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeNumber(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

