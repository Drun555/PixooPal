import { Buffer } from 'node:buffer';
import { getRuntimeConfig, requirePixooHost } from './config';
import { isPixooPalOff } from './control';

export type RGB = [number, number, number];
type PixooCommand = Record<string, unknown> & { Command: string };
type PixooPowerListener = (state: PixooPowerState) => void;
type PixooRecoveryListener = (state: PixooRecoveryState) => void;

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

const reachabilityState = getPixooReachabilityState();
const drawState = getPixooDrawState();

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
    return body;
  } catch (error) {
    markPixooReachability(false);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPixooSettings() {
  try {
    const settings = await sendPixooCommand({ Command: 'Channel/GetAllConf' });
    syncPixooScreenPowerFromSettings(settings);
    return settings;
  } catch (error) {
    markPixooReachability(false);
    throw error;
  }
}

export function getEmptyPreviewBuffer() {
  return {
    size: PIXOO_SIZE,
    buffer: new Array(PIXOO_SIZE * PIXOO_SIZE * 3).fill(0) as number[]
  };
}

export async function setBrightness(value: number) {
  const brightness = clampInt(value, 0, 100);

  return sendPixooCommand({
    Command: 'Channel/SetBrightness',
    Brightness: brightness
  });
}

export async function setWhiteBalance(red: number, green: number, blue: number) {
  return sendPixooCommand({
    Command: 'Device/SetWhiteBalance',
    RValue: clampInt(red, 0, 100),
    GValue: clampInt(green, 0, 100),
    BValue: clampInt(blue, 0, 100)
  });
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

export async function pushPixelBuffer(size: number, buffer: number[]) {
  if (isPixooPalOff()) {
    throw new Error('PixooPal is paused.');
  }

  const resolution = normalizePixooFrameResolution(size);
  const expectedLength = resolution * resolution * 3;

  if (buffer.length < expectedLength) {
    throw new Error(`Pixel buffer is too small for ${resolution}x${resolution}.`);
  }

  await waitForPixooDrawReady();

  if (shouldResetHttpGifId(resolution)) {
    await sendPixooCommand({
      Command: 'Draw/ResetHttpGifId'
    });
  }

  const picId = drawState.framesSinceReset + 1;
  const response = await sendPixooCommand({
    Command: 'Draw/SendHttpGif',
    PicNum: 1,
    PicWidth: resolution,
    PicOffset: 0,
    PicID: picId,
    PicSpeed: 1000,
    PicData: encodeFrameData(buffer, expectedLength)
  });

  drawState.framesSinceReset += 1;

  return response;
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

function clampColor(value: unknown) {
  const color = Number(value);

  if (!Number.isFinite(color)) {
    return 0;
  }

  return Math.max(0, Math.min(255, Math.round(color)));
}

function encodeFrameData(buffer: number[], expectedLength: number) {
  return Buffer.from(buffer.slice(0, expectedLength).map(clampColor)).toString('base64');
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
    powerListeners: new Set(),
    recoveryListeners: new Set()
  };

  globalScope[key].powerListeners ??= new Set();
  globalScope[key].recoveryListeners ??= new Set();
  globalScope[key].screenOn ??= true;
  globalScope[key].screenObserved ??= false;
  globalScope[key].drawCooldownUntil ??= 0;

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
