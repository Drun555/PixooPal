import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { getRuntimeConfig, requirePixooHost } from './config';
import { isPixooPalOff } from './control';
import { debugLog } from './debug';

export type RGB = [number, number, number];
type PixooCommand = Record<string, unknown> & { Command: string };
type PixooPowerListener = (state: PixooPowerState) => void;
type PixooRecoveryListener = (state: PixooRecoveryState) => void;
export type PixooCommandSample = {
  command: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  startedAtMs: number;
};

export type PixooFramePushMetrics = {
  waitReadyMs: number;
  resetMs: number;
  encodeMs: number;
  sendMs: number;
  postSendDelayMs: number;
  frameBytes: number;
  base64Bytes: number;
};

export type PixooFramePushResult = {
  response: unknown;
  metrics: PixooFramePushMetrics;
};

export type PixooRecoveryState = {
  reachable: boolean;
  screenOn: boolean;
  drawCooldownRemainingMs: number;
  drawReadyAt: string | null;
};

export type PixooPowerState = PixooRecoveryState;

type PixooReachabilityState = {
  host: string;
  reachable: boolean;
  observed: boolean;
  screenOn: boolean;
  screenObserved: boolean;
  drawCooldownUntil: number;
  settings: unknown | null;
  powerListeners: Set<PixooPowerListener>;
  recoveryListeners: Set<PixooRecoveryListener>;
};

type PixooDrawState = {
  host: string;
  resolution: number | null;
  framesSinceReset: number;
};

const PIXOO_SIZE = 64;
const PIXOO_DRAW_RECOVERY_DELAY_MS = 5_000;
const PIXOO_FRAME_RESOLUTIONS = [16, 32, 64] as const;
const HTTP_GIF_RESET_INTERVAL_FRAMES = 58;
const PIXOO_CUSTOM_CHANNEL_INDEX = 3;
const PIXOO_64_POST_SEND_DELAY_MS = 50;

const reachabilityState = getPixooReachabilityState();
const drawState = getPixooDrawState();
let commandCollector: { startedAt: number; samples: PixooCommandSample[] } | undefined;

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected a finite number between ${min} and ${max}.`);
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

export async function sendPixooCommand(command: PixooCommand) {
  const config = requirePixooHost();
  const { controller, timeout } = withTimeout(5000);
  const startedAt = Date.now();

  try {
    const response = await fetch(config.pixooPostUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });

    const bodyText = await response.text();
    const body = bodyText ? safeParseJson(bodyText) : {};

    if (!response.ok) {
      markPixooReachability(false);
      throw new Error(`Pixoo returned HTTP ${response.status}: ${bodyText}`);
    }

    markPixooReachability(true);
    collectPixooCommand(command.Command, startedAt, true);
    debugLog('Pixoo command completed.', {
      command: command.Command,
      durationMs: Date.now() - startedAt
    });
    return body;
  } catch (error) {
    markPixooReachability(false);
    collectPixooCommand(command.Command, startedAt, false, error);
    debugLog('Pixoo command failed.', {
      command: command.Command,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function startPixooCommandCollection() {
  if (commandCollector) {
    throw new Error('Pixoo command collection is already running.');
  }

  commandCollector = {
    startedAt: Date.now(),
    samples: []
  };

  return () => {
    const samples = commandCollector?.samples ?? [];
    commandCollector = undefined;
    return samples;
  };
}

export async function getPixooSettings() {
  try {
    const settings = await sendPixooCommand({ Command: 'Channel/GetAllConf' });
    cachePixooSettings(settings);
    syncPixooScreenPowerFromSettings(settings);
    return settings;
  } catch (error) {
    markPixooReachability(false);
    throw error;
  }
}

export function getCachedPixooSettings() {
  syncReachabilityHost();
  return reachabilityState.settings;
}

export async function getPixooSettingsSnapshot() {
  const config = requirePixooHost();
  const { controller, timeout } = withTimeout(2000);

  try {
    const response = await fetch(config.pixooPostUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ Command: 'Channel/GetAllConf' }),
      signal: controller.signal
    });

    const bodyText = await response.text();
    const body = bodyText ? safeParseJson(bodyText) : {};

    if (!response.ok) {
      throw new Error(`Pixoo returned HTTP ${response.status}: ${bodyText}`);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function getEmptyPreviewBuffer() {
  return {
    size: PIXOO_SIZE,
    buffer: new Uint8Array(PIXOO_SIZE * PIXOO_SIZE * 3)
  };
}

export async function setBrightness(value: number) {
  const brightness = clampInt(value, 0, 100);

  const response = await sendPixooCommand({
    Command: 'Channel/SetBrightness',
    Brightness: brightness
  });

  updateCachedPixooSettings({ Brightness: brightness });
  return response;
}

export async function setWhiteBalance(red: number, green: number, blue: number) {
  const values = {
    RValue: clampInt(red, 0, 100),
    GValue: clampInt(green, 0, 100),
    BValue: clampInt(blue, 0, 100)
  };
  const response = await sendPixooCommand({
    Command: 'Device/SetWhiteBalance',
    ...values
  });

  updateCachedPixooSettings(values);
  return response;
}

export async function setScreen(on: boolean) {
  const enabled = on ? 1 : 0;
  const response = await sendPixooCommand({
    Command: 'Channel/OnOffScreen',
    OnOff: enabled
  });

  markPixooScreenPower(on, {
    forceRecovery: on
  });
  updateCachedPixooSettings({ LightSwitch: enabled });

  return response;
}

export async function setCustomChannel() {
  return sendPixooCommand({
    Command: 'Channel/SetIndex',
    SelectIndex: PIXOO_CUSTOM_CHANNEL_INDEX
  });
}

export async function playBuzzer() {
  return sendPixooCommand({
    Command: 'Device/PlayBuzzer',
    ActiveTimeInCycle: 120,
    OffTimeInCycle: 80,
    PlayTotalTime: 520
  });
}

export async function pushPixelBuffer(size: number, buffer: Uint8Array): Promise<PixooFramePushResult> {
  if (isPixooPalOff()) {
    throw new Error('PixooPal is paused.');
  }

  const resolution = normalizePixooFrameResolution(size);
  const expectedLength = resolution * resolution * 3;

  if (buffer.length < expectedLength) {
    throw new Error(`Pixel buffer is too small for ${resolution}x${resolution}.`);
  }

  const waitStarted = performance.now();
  await waitForPixooDrawReady();
  const waitReadyMs = performance.now() - waitStarted;
  let resetMs = 0;

  if (shouldResetHttpGifId(resolution)) {
    debugLog('Resetting Pixoo HTTP GIF id.', {
      resolution,
      framesSinceReset: drawState.framesSinceReset
    });
    const resetStarted = performance.now();
    await sendPixooCommand({
      Command: 'Draw/ResetHttpGifId'
    });
    resetMs = performance.now() - resetStarted;
  }

  const picId = drawState.framesSinceReset + 1;
  debugLog('Sending Pixoo frame.', {
    resolution,
    picId,
    framesSinceReset: drawState.framesSinceReset,
    expectedLength
  });
  const encodeStarted = performance.now();
  const picData = encodeFrameData(buffer, expectedLength);
  const encodeMs = performance.now() - encodeStarted;
  const sendStarted = performance.now();
  const response = await sendPixooCommand({
    Command: 'Draw/SendHttpGif',
    PicNum: 1,
    PicWidth: resolution,
    PicOffset: 0,
    PicID: picId,
    PicSpeed: 1000,
    PicData: picData
  });
  const sendMs = performance.now() - sendStarted;
  const postSendDelayMs = resolution === 64 ? PIXOO_64_POST_SEND_DELAY_MS : 0;

  if (postSendDelayMs > 0) {
    debugLog('Waiting after Pixoo 64x64 frame send.', { postSendDelayMs });
    await delay(postSendDelayMs);
  }

  drawState.framesSinceReset += 1;

  return {
    response,
    metrics: {
      waitReadyMs,
      resetMs,
      encodeMs,
      sendMs,
      postSendDelayMs,
      frameBytes: expectedLength,
      base64Bytes: Buffer.byteLength(picData)
    }
  };
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function collectPixooCommand(command: string, startedAt: number, ok: boolean, error?: unknown) {
  if (!commandCollector) {
    return;
  }

  commandCollector.samples.push({
    command,
    durationMs: Date.now() - startedAt,
    ok,
    error: ok ? undefined : error instanceof Error ? error.message : String(error),
    startedAtMs: startedAt - commandCollector.startedAt
  });
}

function cachePixooSettings(settings: unknown) {
  reachabilityState.settings = settings;
}

function updateCachedPixooSettings(changes: Record<string, unknown>) {
  if (!isRecord(reachabilityState.settings)) {
    reachabilityState.settings = { ...changes };
    return;
  }

  reachabilityState.settings = {
    ...reachabilityState.settings,
    ...changes
  };
}

export function subscribePixooRecovery(listener: PixooRecoveryListener) {
  reachabilityState.recoveryListeners.add(listener);

  return () => {
    reachabilityState.recoveryListeners.delete(listener);
  };
}

export function subscribePixooPower(listener: PixooPowerListener) {
  reachabilityState.powerListeners.add(listener);

  return () => {
    reachabilityState.powerListeners.delete(listener);
  };
}

export function getPixooRecoveryState(): PixooRecoveryState {
  syncReachabilityHost();
  const remaining = Math.max(0, reachabilityState.drawCooldownUntil - Date.now());

  return {
    reachable: reachabilityState.reachable,
    screenOn: reachabilityState.screenOn,
    drawCooldownRemainingMs: remaining,
    drawReadyAt:
      remaining > 0 ? new Date(reachabilityState.drawCooldownUntil).toISOString() : null
  };
}

function markPixooReachability(reachable: boolean) {
  syncReachabilityHost();

  if (!reachabilityState.host) {
    reachabilityState.reachable = false;
    reachabilityState.observed = true;
    reachabilityState.drawCooldownUntil = 0;
    return;
  }

  const wasReachable = reachabilityState.reachable;
  reachabilityState.observed = true;
  reachabilityState.reachable = reachable;

  if (!reachable) {
    reachabilityState.drawCooldownUntil = 0;
    return;
  }

  if (!wasReachable) {
    setPixooDrawRecoveryDelay();
  }
}

async function waitForPixooDrawReady() {
  syncReachabilityHost();
  requirePixooHost();

  if (!reachabilityState.screenOn) {
    throw new Error('Pixoo screen is off.');
  }

  if (!reachabilityState.reachable) {
    await getPixooSettings();
  }

  const remaining = getPixooRecoveryState().drawCooldownRemainingMs;

  if (remaining > 0) {
    debugLog('Waiting for Pixoo draw recovery.', { remainingMs: remaining });
    await delay(remaining);
  }

  if (!reachabilityState.screenOn) {
    throw new Error('Pixoo screen is off.');
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseHexColor(hex: string): RGB {
  const normalized = hex.trim();

  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error('Invalid color. Expected #RRGGBB.');
  }

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16)
  ];
}

function encodeFrameData(buffer: Uint8Array, expectedLength: number) {
  return Buffer.from(buffer.buffer, buffer.byteOffset, expectedLength).toString('base64');
}

function normalizePixooFrameResolution(size: number) {
  const resolution = clampInt(size, 1, PIXOO_SIZE);

  if (!PIXOO_FRAME_RESOLUTIONS.some((supported) => supported === resolution)) {
    throw new Error(
      `Pixoo frame resolution must be one of ${PIXOO_FRAME_RESOLUTIONS.join(', ')}.`
    );
  }

  return resolution;
}

function shouldResetHttpGifId(resolution: number) {
  syncDrawHost();

  if (drawState.resolution !== resolution) {
    drawState.resolution = resolution;
    drawState.framesSinceReset = 0;
    return true;
  }

  return drawState.framesSinceReset % HTTP_GIF_RESET_INTERVAL_FRAMES === 0;
}

function syncPixooScreenPowerFromSettings(settings: unknown) {
  if (!isRecord(settings) || typeof settings.LightSwitch !== 'number') {
    return;
  }

  markPixooScreenPower(settings.LightSwitch === 1, {
    forceRecovery: false
  });
}

function markPixooScreenPower(screenOn: boolean, { forceRecovery }: { forceRecovery: boolean }) {
  syncReachabilityHost();

  const wasScreenOn = reachabilityState.screenOn;
  reachabilityState.screenOn = screenOn;
  reachabilityState.screenObserved = true;

  if (wasScreenOn === screenOn) {
    if (forceRecovery && screenOn) {
      setPixooDrawRecoveryDelay();
    }

    return;
  }

  if (!screenOn) {
    reachabilityState.drawCooldownUntil = 0;
  } else if (forceRecovery || !wasScreenOn) {
    setPixooDrawRecoveryDelay();
  }

  publishPixooPowerState();
}

function setPixooDrawRecoveryDelay() {
  reachabilityState.drawCooldownUntil = Date.now() + PIXOO_DRAW_RECOVERY_DELAY_MS;
  const recovery = getPixooRecoveryState();

  for (const listener of reachabilityState.recoveryListeners) {
    listener(recovery);
  }
}

function publishPixooPowerState() {
  const power = getPixooRecoveryState();

  for (const listener of reachabilityState.powerListeners) {
    listener(power);
  }
}

function syncReachabilityHost() {
  const host = getRuntimeConfig().pixooHost;

  if (reachabilityState.host !== host) {
    reachabilityState.host = host;
    reachabilityState.reachable = false;
    reachabilityState.observed = false;
    reachabilityState.screenOn = true;
    reachabilityState.screenObserved = false;
    reachabilityState.drawCooldownUntil = 0;
    reachabilityState.settings = null;
  }
}

function syncDrawHost() {
  const host = getRuntimeConfig().pixooHost;

  if (drawState.host !== host) {
    drawState.host = host;
    drawState.resolution = null;
    drawState.framesSinceReset = 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPixooReachabilityState() {
  const key = Symbol.for('pixoopal.pixoo.reachability');
  const globalScope = globalThis as typeof globalThis & {
    [key]?: PixooReachabilityState;
  };

  globalScope[key] ??= {
    host: '',
    reachable: false,
    observed: false,
    screenOn: true,
    screenObserved: false,
    drawCooldownUntil: 0,
    settings: null,
    powerListeners: new Set(),
    recoveryListeners: new Set()
  };

  globalScope[key].powerListeners ??= new Set();
  globalScope[key].recoveryListeners ??= new Set();
  globalScope[key].screenOn ??= true;
  globalScope[key].screenObserved ??= false;
  globalScope[key].drawCooldownUntil ??= 0;
  globalScope[key].settings ??= null;

  return globalScope[key];
}

function getPixooDrawState() {
  const key = Symbol.for('pixoopal.pixoo.draw');
  const globalScope = globalThis as typeof globalThis & {
    [key]?: PixooDrawState;
  };

  globalScope[key] ??= {
    host: '',
    resolution: null,
    framesSinceReset: 0
  };

  globalScope[key].host ??= '';
  globalScope[key].resolution ??= null;
  globalScope[key].framesSinceReset ??= 0;

  return globalScope[key];
}
