import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { divoomJson, divoomOptions } from '$lib/server/divoomHttp';
import {
  getMitmMqttConfig,
  MITM_DEVICE_ID,
  MITM_DEVICE_TOKEN
} from '$lib/server/mitmMqtt';

export const GET: RequestHandler = async (event) => handleInitV2(event);
export const POST: RequestHandler = async (event) => handleInitV2(event);
export const OPTIONS: RequestHandler = async () => divoomOptions();

async function handleInitV2({ request, url }: RequestEvent) {
  console.log(
    `[PixooPal MITM] Pixoo tried to reach /Device/InitV2 via ${request.method}`
  );

  const queryPayload = getQueryPayload(url.searchParams);
  const payload = hasInitV2Payload(queryPayload) ? queryPayload : await readMaybeJsonBody(request);
  const deviceMacAddr = getStringValue(
    payload.DeviceMacAddr,
    url.searchParams.get('DeviceMacAddr'),
    request.headers.get('x-pixoopal-initv2-device-mac-addr')
  );
  const packetFlag = normalizeNumber(
    payload.PacketFlag ??
      url.searchParams.get('PacketFlag') ??
      request.headers.get('x-pixoopal-initv2-packet-flag'),
    0
  );
  const now = Math.floor(Date.now() / 1000);
  const mqtt = getMitmMqttConfig();

  console.log(
    `[PixooPal MITM] Pixoo reached /Device/InitV2: DeviceMacAddr=${deviceMacAddr || '(empty)'}, PacketFlag=${packetFlag}. Replying with embedded MQTT broker=${mqtt.responseAddress}:1883.`
  );

  return divoomJson({
    ReturnCode: 0,
    ReturnMessage: '',
    DevicePublicIP: '127.0.0.1',
    IP: mqtt.responseAddress,
    BackupIP: mqtt.responseAddress,
    lot: 0,
    lat: 0,
    SummerZone: 0,
    TimeZoneCode: 'UTC',
    UTCTime: now,
    DeviceId: MITM_DEVICE_ID,
    UserId: 0,
    LogLevel: 0,
    IsResetAll: 0,
    DeviceToken: MITM_DEVICE_TOKEN,
    ServerType: 1,
    LastClockId: 57,
    OfflineTime: now,
    OnlineTime: now,
    ScreenOnOff: 1,
    CustomType: 0,
    Command: 'Device/InitV2',
    PacketFlag: packetFlag
  });
}

async function readMaybeJsonBody(request: Request): Promise<Record<string, unknown>> {
  const bodyText = await request.text().catch(() => '');

  if (!bodyText.trim()) {
    return {};
  }

  try {
    const payload = JSON.parse(bodyText) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    console.warn('[PixooPal MITM] /Device/InitV2 received a non-JSON request body.');
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getQueryPayload(searchParams: URLSearchParams): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of searchParams.entries()) {
    payload[key] = value;
  }

  return payload;
}

function hasInitV2Payload(payload: Record<string, unknown>) {
  return payload.DeviceMacAddr !== undefined || payload.PacketFlag !== undefined;
}

function getStringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
