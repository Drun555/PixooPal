import type { Clockface, ClockfaceInput, ClockfaceInputValue } from '$lib/Clockface';
import {
  applyNotificationOverlay,
  isNotificationActive,
  NOTIFICATION_FRAME_MS,
  startNotification
} from './notifications';
import { getRuntimeConfig } from './config';
import {
  getPixooRecoveryState,
  playBuzzer,
  pushPixelBuffer,
  setCustomChannel,
  setScreen,
  subscribePixooPower,
  subscribePixooRecovery
} from './pixoo';
import { publishPixooPalEvent, publishPreviewFrame } from './previewStream';

export type ClockfaceInputView = Omit<ClockfaceInput, 'onSubmit'>;
export type ClockfaceInputRowView = ClockfaceInputView[];

export type ClockfaceView = {
  id: string;
  name: string;
  description?: string;
  picture?: string;
  resolution: number;
  updateIntervalMs: number;
  data: Record<string, string>;
  inputs: ClockfaceInputRowView[];
};

type ClockfaceModule = {
  default: Clockface;
};

type ClockfaceManifest = {
  entry: string;
  name: string;
  id?: string;
  description?: string;
  picture?: string;
};

type ClockfaceRunner = {
  id: string;
  stopped: boolean;
  pendingFrame?: ClockfaceFrame;
  rendering?: boolean;
  sending?: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type ClockfaceFrame = {
  activeId: string;
  buffer: number[];
  size: number;
  updateIntervalMs: number;
};

const PIXOO_NATIVE_SIZE = 64;
const SERVICE_CLOCKFACE_ID = '__pixoopal_service_clockface__';
const SERVICE_CLOCKFACE_HOLD_MS = 500;

type ClockfaceRuntimeState = {
  activeClockfaceId?: string;
  activeRunner?: ClockfaceRunner;
  clockfacesPaused?: boolean;
  dispose?: () => void;
  powerUnsubscribe?: () => void;
  pushQueue?: Promise<void>;
  recoveryTimer?: ReturnType<typeof setTimeout>;
  recoveryUnsubscribe?: () => void;
  serviceTransition?: boolean;
  signalsRegistered?: boolean;
};

const clockfaceRuntimeState = getClockfaceRuntimeState();
clockfaceRuntimeState.dispose?.();

const manifests = import.meta.glob<ClockfaceManifest>('../clockfaces/*/manifest.json', {
  eager: true,
  import: 'default'
});
const modules = import.meta.glob<ClockfaceModule>('../clockfaces/**/*.ts', {
  eager: true
});

const clockfaces = Object.entries(manifests)
  .map(([manifestPath, manifest]) => {
    const modulePath = getManifestModulePath(manifestPath, manifest);
    const module = modules[modulePath];
    const id = normalizeClockfaceId(manifest.id ?? getClockfaceIdFromManifestPath(manifestPath));

    if (!module) {
      throw new Error(`Clockface manifest "${manifestPath}" points to missing entry "${manifest.entry}".`);
    }

    return {
      id,
      name: normalizeOptionalManifestString(manifest.name) ?? getClockfaceName(id),
      description: normalizeOptionalManifestString(manifest.description),
      picture: normalizeOptionalManifestString(manifest.picture),
      instance: module.default
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const persistenceReady = Promise.all(
  clockfaces.map(({ id, instance }) => instance.attachPersistence(id))
);

clockfaceRuntimeState.activeClockfaceId = getInitialActiveClockfaceId();
clockfaceRuntimeState.activeRunner = undefined;
clockfaceRuntimeState.clockfacesPaused ??= false;
clockfaceRuntimeState.pushQueue ??= Promise.resolve();

let disposed = false;

clockfaceRuntimeState.dispose = disposeClockfaces;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeClockfaces();
  });
}

if (!clockfaceRuntimeState.signalsRegistered) {
  const handleProcessStop = () => {
    clockfaceRuntimeState.dispose?.();
  };

  process.once('SIGINT', handleProcessStop);
  process.once('SIGTERM', handleProcessStop);
  clockfaceRuntimeState.signalsRegistered = true;
}

clockfaceRuntimeState.recoveryUnsubscribe = subscribePixooRecovery((recovery) => {
  scheduleClockfaceRecovery(recovery.drawCooldownRemainingMs);
});

clockfaceRuntimeState.powerUnsubscribe = subscribePixooPower((power) => {
  if (clockfaceRuntimeState.serviceTransition) {
    return;
  }

  if (power.screenOn) {
    scheduleClockfaceResume(power.drawCooldownRemainingMs);
    return;
  }

  pauseClockfaces().catch((error) => {
    console.error('Clockface pause failed:', error);
  });
});

refreshActiveClockfaceInBackground();

export async function getClockfacesView() {
  await waitForClockfaces();

  return {
    activeId: getActiveClockfaceId(),
    clockfaces: await Promise.all(
      clockfaces.map(async ({ instance, ...clockface }) => ({
        ...clockface,
        ...(await toClockfaceView(instance))
      }))
    ),
    active: await getActiveClockfaceView()
  };
}

export async function getActiveClockfacePreview() {
  await waitForClockfaces();

  const active = getActiveClockfaceEntry();

  return {
    activeId: active.id,
    updateIntervalMs: getFrameInterval(active.instance),
    preview: await getDisplayBuffer(active.instance)
  };
}

export async function setActiveClockface(id: string) {
  const clockface = getClockfaceEntry(id);
  await stopActiveClockface();
  clockfaceRuntimeState.activeClockfaceId = clockface.id;
  await startActiveClockface(clockface.id);
  const view = await getClockfacesView();

  publishPixooPalEvent({
    type: 'clockface_changed',
    activeId: view.activeId,
    clockface: view.active
  });

  return view;
}

export async function submitClockfaceInput(id: string, value: ClockfaceInputValue) {
  const clockface = getActiveClockfaceEntry();
  await clockface.instance.ready;
  await clockface.instance.submitInput(id, value);

  const runner = getActiveRunner();

  if (!isClockfacesPaused() && runner?.id === clockface.id) {
    await renderRunnerFrame(runner, clockface.instance);
    scheduleNextFrame(runner, clockface.instance);
  }

  const view = await getClockfacesView();

  publishPixooPalEvent({
    type: 'clockface_data_changed',
    activeId: clockface.id,
    data: { ...clockface.instance.data }
  });

  return view;
}

export async function refreshActiveClockface() {
  await waitForClockfaces();

  if (isClockfacesPaused() || !getActiveClockfaceId()) {
    return;
  }

  const clockface = getActiveClockfaceEntry().instance;

  if (!getActiveRunner()) {
    await startActiveClockface(getActiveClockfaceId());
    return;
  }

  const runner = getActiveRunner();

  if (runner?.id !== getActiveClockfaceId()) {
    return;
  }

  await renderRunnerFrame(runner, clockface);

  if (isRunnerActive(runner)) {
    scheduleNextFrame(runner, clockface);
  }
}

export function refreshActiveClockfaceInBackground() {
  if (!getRuntimeConfig().pixooHost) {
    return;
  }

  refreshActiveClockface().catch((error) => {
    console.error('Clockface refresh failed:', error);
  });
}

export async function showNotification(text: string, beep: boolean) {
  startNotification(text);

  if (beep) {
    await playBuzzer();
  }

  if (isClockfacesPaused()) {
    const view = await getClockfacesView();

    publishPixooPalEvent({
      type: 'notification',
      message: text,
      beep
    });

    return view;
  }

  await startActiveClockface(getActiveClockfaceId());

  const runner = getActiveRunner();
  const clockface = getActiveClockfaceEntry().instance;

  if (runner) {
    clearTimeout(runner.timer);
    runner.timer = undefined;
    scheduleNextFrame(runner, clockface);
  }

  if (runner) {
    await renderRunnerFrame(runner, clockface);
  }

  const view = await getClockfacesView();

  publishPixooPalEvent({
    type: 'notification',
    message: text,
    beep
  });

  return view;
}

export async function setPixooScreenWithServiceClockface(on: boolean) {
  clockfaceRuntimeState.serviceTransition = true;

  if (on) {
    try {
      await pauseClockfaces({ publishPreview: false });
      const result = await setScreen(true);
      await enqueueServiceClockfaceFrame();
      scheduleServiceClockfaceResume();
      return result;
    } catch (error) {
      clockfaceRuntimeState.serviceTransition = false;
      throw error;
    }
  }

  try {
    await pauseClockfaces({ publishPreview: false });
    if (getPixooRecoveryState().screenOn) {
      await enqueueServiceClockfaceFrame();
    }
    return await setScreen(false);
  } finally {
    clockfaceRuntimeState.serviceTransition = false;
  }
}

async function getActiveClockfaceView() {
  const active = getActiveClockfaceEntry();

  return {
    id: active.id,
    name: active.name,
    description: active.description,
    picture: active.picture,
    ...(await toClockfaceView(active.instance))
  };
}

function getActiveClockfaceEntry() {
  return getClockfaceEntry(getActiveClockfaceId());
}

function getClockfaceEntry(id: string) {
  const clockface = clockfaces.find((item) => item.id === id);

  if (!clockface) {
    throw new Error(`Clockface "${id}" was not found.`);
  }

  return clockface;
}

async function toClockfaceView(clockface: Clockface) {
  return {
    resolution: clockface.resolution,
    updateIntervalMs: getFrameInterval(clockface),
    data: { ...clockface.data },
    inputs: clockface.inputRows.map((row) => row.map(toClockfaceInputView))
  };
}

function toClockfaceInputView({
  type,
  id,
  friendlyName,
  options,
  accept,
  min,
  max,
  step,
  isSetting
}: ClockfaceInput): ClockfaceInputView {
  return {
    type,
    id,
    friendlyName,
    options,
    accept,
    min,
    max,
    step,
    isSetting: isSetting === true
  };
}

async function waitForClockfaces() {
  await Promise.all([persistenceReady, ...clockfaces.map(({ instance }) => instance.ready)]);
  await Promise.all(clockfaces.map(({ instance }) => instance.waitForPersistence()));
}

async function startActiveClockface(id: string) {
  if (disposed || isClockfacesPaused() || !id || getActiveRunner()?.id === id) {
    return;
  }

  const entry = getClockfaceEntry(id);
  const runner: ClockfaceRunner = {
    id,
    stopped: false
  };

  clockfaceRuntimeState.activeRunner = runner;
  await entry.instance.ready;

  if (runner.stopped) {
    return;
  }

  await entry.instance.start();
  await renderRunnerFrame(runner, entry.instance);
  scheduleNextFrame(runner, entry.instance);
}

async function stopActiveClockface() {
  const runner = getActiveRunner();

  if (!runner) {
    return;
  }

  runner.stopped = true;
  runner.pendingFrame = undefined;
  clearTimeout(runner.timer);
  clockfaceRuntimeState.activeRunner = undefined;
  await getClockfaceEntry(runner.id).instance.stop();
}

function disposeClockfaces() {
  disposed = true;
  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.powerUnsubscribe?.();
  clockfaceRuntimeState.recoveryUnsubscribe?.();
  clockfaceRuntimeState.recoveryTimer = undefined;
  clockfaceRuntimeState.powerUnsubscribe = undefined;
  clockfaceRuntimeState.recoveryUnsubscribe = undefined;

  const runner = getActiveRunner();

  if (!runner) {
    return;
  }

  runner.stopped = true;
  runner.pendingFrame = undefined;
  clearTimeout(runner.timer);
  clockfaceRuntimeState.activeRunner = undefined;
  getClockfaceEntry(runner.id).instance.stop().catch((error) => {
    console.error('Clockface stop failed:', error);
  });
}

function scheduleNextFrame(runner: ClockfaceRunner, clockface: Clockface) {
  if (
    disposed ||
    isClockfacesPaused() ||
    runner.stopped ||
    runner.pendingFrame ||
    runner.rendering ||
    runner.timer ||
    getFrameInterval(clockface) === 0
  ) {
    return;
  }

  runner.timer = setTimeout(() => {
    runner.timer = undefined;
    runFrame(runner, clockface).catch((error) => {
      console.error('Clockface frame failed:', error);
      scheduleNextFrame(runner, clockface);
    });
  }, getFrameInterval(clockface));
}

async function runFrame(runner: ClockfaceRunner, clockface: Clockface) {
  if (disposed || isClockfacesPaused() || runner.stopped || getActiveRunner() !== runner) {
    return;
  }

  await renderRunnerFrame(runner, clockface);
}

async function renderRunnerFrame(runner: ClockfaceRunner, clockface: Clockface) {
  if (!isRunnerActive(runner) || runner.pendingFrame || runner.rendering) {
    return;
  }

  runner.rendering = true;

  try {
    await clockface.render();

    if (!isRunnerActive(runner)) {
      return;
    }

    const display = await getDisplayBuffer(clockface);

    if (!isRunnerActive(runner)) {
      return;
    }

    runner.pendingFrame = {
      activeId: runner.id,
      buffer: display.buffer,
      size: display.size,
      updateIntervalMs: getFrameInterval(clockface)
    };
  } finally {
    runner.rendering = false;
  }

  pushPendingFramesInBackground(runner);
}

function pushPendingFramesInBackground(runner: ClockfaceRunner) {
  if (runner.sending) {
    return;
  }

  runner.sending = true;

  pushPendingFrames(runner).catch((error) => {
    console.error('Clockface push failed:', error);
  });
}

async function pushPendingFrames(runner: ClockfaceRunner) {
  try {
    while (isRunnerActive(runner) && runner.pendingFrame) {
      const frame = runner.pendingFrame;
      runner.pendingFrame = undefined;
      scheduleNextFrame(runner, getClockfaceEntry(runner.id).instance);
      await enqueueFramePush(runner, frame);
    }
  } finally {
    runner.sending = false;

    if (isRunnerActive(runner) && runner.pendingFrame) {
      pushPendingFramesInBackground(runner);
    }
  }
}

async function enqueueFramePush(runner: ClockfaceRunner, frame: ClockfaceFrame) {
  clockfaceRuntimeState.pushQueue = clockfaceRuntimeState.pushQueue?.then(
    () => pushFrame(runner, frame),
    () => pushFrame(runner, frame)
  );

  await clockfaceRuntimeState.pushQueue;
}

async function pushFrame(runner: ClockfaceRunner, frame: ClockfaceFrame) {
  if (!isRunnerActive(runner)) {
    return;
  }

  await pushPixelBuffer(frame.size, frame.buffer);

  if (!isRunnerActive(runner)) {
    return;
  }

  publishPreviewFrame({
    activeId: frame.activeId,
    updateIntervalMs: frame.updateIntervalMs,
    preview: {
      size: frame.size,
      buffer: frame.buffer
    }
  });
}

async function pauseClockfaces({ publishPreview = true }: { publishPreview?: boolean } = {}) {
  clockfaceRuntimeState.clockfacesPaused = true;
  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.recoveryTimer = undefined;
  await stopActiveClockface();

  if (publishPreview) {
    publishBlackPreview();
  }
}

function scheduleClockfaceResume(delayMs: number) {
  clockfaceRuntimeState.clockfacesPaused = true;
  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.recoveryTimer = setTimeout(() => {
    if (disposed || !getActiveClockfaceId()) {
      return;
    }

    clockfaceRuntimeState.clockfacesPaused = false;
    refreshActiveClockface().catch((error) => {
      console.error('Clockface resume failed:', error);
    });
  }, Math.max(0, delayMs));
}

function scheduleServiceClockfaceResume() {
  clockfaceRuntimeState.clockfacesPaused = true;
  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.recoveryTimer = setTimeout(() => {
    clockfaceRuntimeState.serviceTransition = false;

    if (disposed || !getActiveClockfaceId()) {
      return;
    }

    clockfaceRuntimeState.clockfacesPaused = false;
    refreshActiveClockface().catch((error) => {
      console.error('Clockface service resume failed:', error);
    });
  }, SERVICE_CLOCKFACE_HOLD_MS);
}

async function enqueueServiceClockfaceFrame() {
  clockfaceRuntimeState.pushQueue = clockfaceRuntimeState.pushQueue?.then(
    () => pushServiceClockfaceFrame(),
    () => pushServiceClockfaceFrame()
  );

  await clockfaceRuntimeState.pushQueue;
}

async function pushServiceClockfaceFrame() {
  if (disposed) {
    return;
  }

  const preview = getServiceClockfacePreview();

  await setCustomChannel();
  await pushPixelBuffer(preview.size, preview.buffer);

  publishPreviewFrame({
    activeId: getActiveClockfaceId() || SERVICE_CLOCKFACE_ID,
    updateIntervalMs: 0,
    preview
  });
}

function scheduleClockfaceRecovery(delayMs: number) {
  if (isClockfacesPaused()) {
    return;
  }

  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.recoveryTimer = setTimeout(() => {
    if (disposed || isClockfacesPaused() || !getActiveClockfaceId()) {
      return;
    }

    const clockface = getActiveClockfaceEntry().instance;

    if (!getActiveRunner()) {
      startActiveClockface(getActiveClockfaceId()).catch((error) => {
        console.error('Clockface recovery start failed:', error);
      });
      return;
    }

    const runner = getActiveRunner();

    if (runner?.id === getActiveClockfaceId()) {
      renderRunnerFrame(runner, clockface).catch((error) => {
        console.error('Clockface recovery render failed:', error);
      });
      scheduleNextFrame(runner, clockface);
    }
  }, Math.max(0, delayMs));
}

function publishBlackPreview() {
  const active = getActiveClockfaceEntry();
  const size = active.instance.resolution;

  publishPreviewFrame({
    activeId: active.id,
    updateIntervalMs: 0,
    preview: {
      size,
      buffer: new Array(size * size * 3).fill(0)
    }
  });
}

function getServiceClockfacePreview() {
  const size = PIXOO_NATIVE_SIZE;
  const buffer = new Array(size * size * 3).fill(0);

  drawServiceBackground(buffer, size);
  drawGear(buffer, size, Math.floor(size / 2), Math.floor(size / 2), 21, 10);

  return {
    size,
    buffer
  };
}

function drawServiceBackground(buffer: number[], size: number) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shade = 8 + Math.round((y / (size - 1)) * 16);
      setFlatPixel(buffer, size, x, y, shade, shade + 2, shade + 6);
    }
  }
}

function drawGear(
  buffer: number[],
  size: number,
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number
) {
  const toothCount = 10;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const tooth = Math.cos(angle * toothCount);
      const radius = outerRadius + (tooth > 0.35 ? 5 : 0);
      const onGear = distance <= radius && distance >= innerRadius;
      const onHub = distance <= 5;

      if (!onGear && !onHub) {
        continue;
      }

      const highlight = distance < 15 || (dx < -2 && dy < -2) ? 32 : 0;
      setFlatPixel(
        buffer,
        size,
        x,
        y,
        98 + highlight,
        118 + highlight,
        138 + highlight
      );
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance >= innerRadius - 2 && distance <= innerRadius + 1) {
        setFlatPixel(buffer, size, x, y, 18, 22, 30);
      }
    }
  }
}

function setFlatPixel(
  buffer: number[],
  size: number,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number
) {
  if (x < 0 || x >= size || y < 0 || y >= size) {
    return;
  }

  const index = (x + y * size) * 3;
  buffer[index] = red;
  buffer[index + 1] = green;
  buffer[index + 2] = blue;
}

async function getDisplayBuffer(clockface: Clockface) {
  if (!isNotificationActive()) {
    return {
      size: clockface.resolution,
      buffer: clockface.flatBuffer
    };
  }

  const size = PIXOO_NATIVE_SIZE;
  const buffer =
    clockface.resolution === size
      ? clockface.flatBuffer
      : scaleFlatBuffer(clockface.flatBuffer, clockface.resolution, size);

  return {
    size,
    buffer: await applyNotificationOverlay(size, buffer)
  };
}

function scaleFlatBuffer(source: number[], sourceSize: number, targetSize: number) {
  const output = new Array(targetSize * targetSize * 3).fill(0);

  for (let y = 0; y < targetSize; y += 1) {
    const sourceY = Math.min(sourceSize - 1, Math.floor((y / targetSize) * sourceSize));

    for (let x = 0; x < targetSize; x += 1) {
      const sourceX = Math.min(sourceSize - 1, Math.floor((x / targetSize) * sourceSize));
      const sourceIndex = (sourceX + sourceY * sourceSize) * 3;
      const targetIndex = (x + y * targetSize) * 3;

      output[targetIndex] = source[sourceIndex] ?? 0;
      output[targetIndex + 1] = source[sourceIndex + 1] ?? 0;
      output[targetIndex + 2] = source[sourceIndex + 2] ?? 0;
    }
  }

  return output;
}

function getFrameInterval(clockface: Clockface) {
  if (isNotificationActive()) {
    return clockface.updateIntervalMs > 0
      ? Math.min(clockface.updateIntervalMs, NOTIFICATION_FRAME_MS)
      : NOTIFICATION_FRAME_MS;
  }

  return clockface.updateIntervalMs;
}

function getManifestModulePath(manifestPath: string, manifest: ClockfaceManifest) {
  const entry = manifest.entry.trim().replace(/^\.\/+/, '');

  if (!entry || entry.includes('..') || entry.startsWith('/')) {
    throw new Error(`Clockface manifest "${manifestPath}" has invalid entry "${manifest.entry}".`);
  }

  return `${manifestPath.replace(/\/manifest\.json$/, '')}/${entry}`;
}

function getClockfaceIdFromManifestPath(path: string) {
  return normalizeClockfaceId(path.split('/').at(-2) ?? path);
}

function getClockfaceName(id: string) {
  return splitCamelCase(id);
}

function normalizeClockfaceId(id: string) {
  return id.trim().replace(/[^\w-]/g, '') || 'Clockface';
}

function normalizeOptionalManifestString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function splitCamelCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function getInitialActiveClockfaceId() {
  const currentId = clockfaceRuntimeState.activeClockfaceId;

  if (currentId && clockfaces.some((clockface) => clockface.id === currentId)) {
    return currentId;
  }

  return clockfaces[0]?.id ?? '';
}

function getActiveClockfaceId() {
  return clockfaceRuntimeState.activeClockfaceId ?? '';
}

function getActiveRunner() {
  return clockfaceRuntimeState.activeRunner;
}

function isRunnerActive(runner: ClockfaceRunner) {
  return !disposed && !isClockfacesPaused() && !runner.stopped && getActiveRunner() === runner;
}

function isClockfacesPaused() {
  return clockfaceRuntimeState.clockfacesPaused === true;
}

function getClockfaceRuntimeState() {
  const key = Symbol.for('pixoopal.clockfaces.runtime');
  const globalScope = globalThis as typeof globalThis & {
    [key]?: ClockfaceRuntimeState;
  };

  globalScope[key] ??= {};
  globalScope[key].pushQueue ??= Promise.resolve();
  globalScope[key].clockfacesPaused ??= false;
  globalScope[key].serviceTransition ??= false;
  return globalScope[key];
}
