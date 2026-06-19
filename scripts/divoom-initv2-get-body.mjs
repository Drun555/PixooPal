import { Buffer } from 'node:buffer';

const INIT_V2_PATH = '/Device/InitV2';
const MAX_BODY_BYTES = 64 * 1024;

/**
 * @typedef {import('node:http').IncomingMessage & { url?: string }} InitV2Request
 */

/**
 * @param {InitV2Request} request
 */
export async function prepareDivoomInitV2GetBody(request) {
  if (request.method !== 'GET' || !isInitV2Path(request.url)) {
    return;
  }

  const contentLength = Number.parseInt(String(request.headers['content-length'] ?? ''), 10);
  const bodyText = await readIncomingBody(request);

  if (!bodyText.trim()) {
    console.warn(
      `[PixooPal MITM] GET /Device/InitV2 arrived without readable body. Content-Length=${Number.isFinite(contentLength) ? contentLength : '(empty)'}.`
    );
    return;
  }

  const payload = parseInitV2Body(bodyText);

  if (!payload) {
    console.warn(
      `[PixooPal MITM] GET /Device/InitV2 body was present (${Buffer.byteLength(bodyText)} bytes) but could not be parsed.`
    );
    return;
  }

  request.url = appendPayloadToQuery(request.url, payload);
  appendPayloadToHeaders(request, payload);

  console.log(
    `[PixooPal MITM] Captured GET /Device/InitV2 body: bytes=${Buffer.byteLength(bodyText)}, DeviceMacAddr=${stringValue(payload.DeviceMacAddr) || '(empty)'}, PacketFlag=${stringValue(payload.PacketFlag) || '(empty)'}`
  );
}

/**
 * @param {string | undefined} url
 */
function isInitV2Path(url) {
  try {
    return new URL(url || '', 'http://pixoopal.local').pathname === INIT_V2_PATH;
  } catch {
    return false;
  }
}

/**
 * @param {InitV2Request} request
 * @returns {Promise<string>}
 */
function readIncomingBody(request) {
  const contentLength = Number.parseInt(String(request.headers['content-length'] ?? ''), 10);
  const transferEncoding = String(request.headers['transfer-encoding'] ?? '').trim();

  if ((!Number.isFinite(contentLength) || contentLength <= 0) && !transferEncoding) {
    return Promise.resolve('');
  }

  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (/** @type {Buffer | string} */ chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > MAX_BODY_BYTES) {
        request.destroy(new Error('GET /Device/InitV2 body is too large.'));
        return;
      }

      chunks.push(buffer);
    });

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    request.on('error', reject);
  });
}

/**
 * @param {string} bodyText
 * @returns {Record<string, unknown> | null}
 */
function parseInitV2Body(bodyText) {
  const trimmed = bodyText.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{')) {
    try {
      const payload = JSON.parse(trimmed);
      return isRecord(payload) ? payload : null;
    } catch {
      return parseJsonLikeInitV2Body(trimmed);
    }
  }

  const params = new URLSearchParams(trimmed);
  /** @type {Record<string, unknown>} */
  const payload = {};

  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

/**
 * @param {string} bodyText
 * @returns {Record<string, unknown> | null}
 */
function parseJsonLikeInitV2Body(bodyText) {
  const deviceMacAddr = matchJsonStringField(bodyText, 'DeviceMacAddr');
  const packetFlag = matchJsonNumberField(bodyText, 'PacketFlag');

  if (!deviceMacAddr && packetFlag === undefined) {
    return null;
  }

  /** @type {Record<string, unknown>} */
  const payload = {};

  if (deviceMacAddr) {
    payload.DeviceMacAddr = deviceMacAddr;
  }

  if (packetFlag !== undefined) {
    payload.PacketFlag = packetFlag;
  }

  return payload;
}

/**
 * @param {string | undefined} requestUrl
 * @param {Record<string, unknown>} payload
 */
function appendPayloadToQuery(requestUrl, payload) {
  const url = new URL(requestUrl || INIT_V2_PATH, 'http://pixoopal.local');

  for (const [key, value] of Object.entries(payload)) {
    if (!isQuerySafeValue(value) || url.searchParams.has(key)) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return `${url.pathname}${url.search}`;
}

/**
 * @param {InitV2Request} request
 * @param {Record<string, unknown>} payload
 */
function appendPayloadToHeaders(request, payload) {
  const deviceMacAddr = stringValue(payload.DeviceMacAddr);
  const packetFlag = stringValue(payload.PacketFlag);

  if (deviceMacAddr) {
    request.headers['x-pixoopal-initv2-device-mac-addr'] = deviceMacAddr;
  }

  if (packetFlag) {
    request.headers['x-pixoopal-initv2-packet-flag'] = packetFlag;
  }
}

/**
 * @param {string} bodyText
 * @param {string} field
 */
function matchJsonStringField(bodyText, field) {
  const match = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, 'i').exec(bodyText);
  return match?.[1] ?? '';
}

/**
 * @param {string} bodyText
 * @param {string} field
 */
function matchJsonNumberField(bodyText, field) {
  const match = new RegExp(`"${field}"\\s*:\\s*(-?\\d+)`, 'i').exec(bodyText);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * @param {unknown} value
 */
function isQuerySafeValue(value) {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * @param {unknown} value
 */
function stringValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
