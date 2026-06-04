import { stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Clockface, type ClockfaceInput, type ClockfaceInputValue } from '@pixoopal/clockface';
import {
  applyNotificationOverlay,
  needsNotificationFrame,
  NOTIFICATION_FRAME_MS,
  startNotification
} from './notifications';
import { getPixooPalControlState, isPixooPalOff, subscribePixooPalControl } from './control';
import { getRuntimeConfig } from './config';
import {
  getPixooRecoveryState,
  playBuzzer,
  pushPixelBuffer,
  setCustomChannel,
  setScreen,
  subscribePixooPower,
  subscribePixooRecovery,
  getPixooFrameSettleMs,
  type PixooFramePushMetrics
} from './pixoo';
import { publishPixooPalEvent, publishPreviewFrame } from './previewStream';
import { fileClockfacePersistenceStore } from './clockfacePersistence';
import { getCommunityClockfacesDebugInfo, getInstalledCommunityClockfaces } from './communityClockfaces';
import { getClockfaceHomeAssistantClient } from './homeAssistant';
import { debugLog } from './debug';

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

type ClockfaceFrameProvider = {
  getFrame?: () => {
    size: number;
    buffer: Uint8Array;
  };
};

type ClockfaceFrameQueueProvider = {
  frameQueueSize?: number;
};

type ClockfaceManifest = {
  entry: string;
  name: string;
  id?: string;
  description?: string;
  picture?: string;
};

type ClockfaceEntry = {
  id: string;
  name: string;
  description?: string;
  picture?: string;
  instance: Clockface;
  source: 'bundled' | 'community';
};

type ClockfaceRunner = {
  id: string;
  stopped: boolean;
  pendingFrames: ClockfaceFrame[];
  nextPushAt?: number;
  lastPushStartedAt?: number;
  nextFrameId: number;
  nextScheduledDelayMs?: number | null;
  rendering?: boolean;
  sending?: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type ClockfaceFrame = {
  activeId: string;
  buffer: Uint8Array;
  enqueuedAt: number;
  frameId: number;
  scheduledDelayMs: number | null;
  size: number;
  updateIntervalMs: number;
};

export type ClockfaceRenderBenchmarkSample = {
  frameId: number;
  renderMs: number;
  displayBufferMs: number;
  renderStartGapMs: number | null;
  queueBefore: number;
  queueAfter: number;
  scheduledDelayMs: number | null;
  startedAtMs: number;
};

export type ClockfacePushBenchmarkSample = {
  frameId: number;
  queueWaitMs: number;
  pendingAfterShift: number;
  pushStartGapMs: number | null;
  pushDurationMs: number;
  encodeMs?: number;
  sendMs?: number;
  previewPublishMs?: number;
  waitReadyMs?: number;
  resetMs?: number;
  postSendDelayMs?: number;
  frameBytes?: number;
  base64Bytes?: number;
  size: number;
  updateIntervalMs: number;
  startedAtMs: number;
};

type ClockfaceFramePushDetails = PixooFramePushMetrics & {
  previewPublishMs: number;
};

export type ClockfaceSchedulerBenchmark = {
  scheduled: number;
  blockReasons: Record<string, number>;
};

type ClockfaceBenchmarkCollector = {
  runnerId: string;
  startedAt: number;
  renderSamples: ClockfaceRenderBenchmarkSample[];
  pushSamples: ClockfacePushBenchmarkSample[];
  scheduler: ClockfaceSchedulerBenchmark;
  lastRenderStartedAt?: number;
  lastPushStartedAt?: number;
};

const PIXOO_NATIVE_SIZE = 64;
const CLOCKFACE_FRAME_BUFFER_SIZE = 5;
const SERVICE_CLOCKFACE_ID = '__pixoopal_service_clockface__';
const SERVICE_CLOCKFACE_HOLD_MS = 500;

type ClockfaceRuntimeState = {
  activeClockfaceId?: string;
  activeRunner?: ClockfaceRunner;
  clockfacesPaused?: boolean;
  dispose?: () => void;
  controlUnsubscribe?: () => void;
  powerUnsubscribe?: () => void;
  pushQueue?: Promise<void>;
  recoveryTimer?: ReturnType<typeof setTimeout>;
  recoveryUnsubscribe?: () => void;
  benchmarkCollector?: ClockfaceBenchmarkCollector;
  serviceTransition?: boolean;
  signalsRegistered?: boolean;
};

const clockfaceRuntimeState = getClockfaceRuntimeState();
clockfaceRuntimeState.dispose?.();
Clockface.configurePersistence(fileClockfacePersistenceStore);
Clockface.configureHomeAssistant(getClockfaceHomeAssistantClient());

const manifests = import.meta.glob<ClockfaceManifest>('../clockfaces/*/manifest.json', {
  eager: true,
  import: 'default'
});
const modules = import.meta.glob<ClockfaceModule>('../clockfaces/**/*.ts', {
  eager: true
});

const bundledClockfaces: ClockfaceEntry[] = Object.entries(manifests)
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
      instance: module.default,
      source: 'bundled' as const
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

let clockfaces = [...bundledClockfaces];
let communityClockfacesReady: Promise<void> | undefined = refreshInstalledCommunityClockfaces();

const bundledPersistenceReady = Promise.all(
  bundledClockfaces.map(({ id, instance }) => instance.attachPersistence(id))
);

clockfaceRuntimeState.activeClockfaceId = getInitialActiveClockfaceId();
clockfaceRuntimeState.activeRunner = undefined;
clockfaceRuntimeState.clockfacesPaused = getPixooPalControlState().pixooPalOff;
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
  scheduleServiceClockfaceRecovery(recovery.drawCooldownRemainingMs).catch((error) => {
    console.error('Clockface service recovery failed:', error);
  });
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

clockfaceRuntimeState.controlUnsubscribe = subscribePixooPalControl(async (control) => {
  if (control.pixooPalOff) {
    await pauseClockfaces({ publishPreview: false });
    return;
  }

  scheduleClockfaceResume(getPixooRecoveryState().drawCooldownRemainingMs);
});

refreshActiveClockfaceInBackground();

export async function refreshCommunityClockfaces() {
  const previousActiveId = getActiveClockfaceId();
  communityClockfacesReady = refreshInstalledCommunityClockfaces();
  await communityClockfacesReady;

  if (previousActiveId && !clockfaces.some((clockface) => clockface.id === previousActiveId)) {
    await stopActiveClockface();
    clockfaceRuntimeState.activeClockfaceId = getInitialActiveClockfaceId();

    if (!isClockfacesPaused()) {
      await startActiveClockface(getActiveClockfaceId());
    }
  }
}

export async function getClockfacesView() {
  await waitForClockfaces();

  return {
    activeId: getActiveClockfaceId(),
    clockfaces: await Promise.all(
      clockfaces.map(async ({ instance, source: _source, ...clockface }) => ({
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

export async function refreshActiveClockfacePreview() {
  const frame = await getActiveClockfacePreview();
  publishPreviewFrame(frame);
  return frame;
}

export async function setActiveClockface(id: string) {
  await waitForClockfaces();

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
    debugLog('Clearing pending frames after clockface input submit.', {
      runnerId: runner.id,
      pendingFrames: runner.pendingFrames.length
    });
    runner.pendingFrames = [];
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

  debugLog('Clearing pending frames before active clockface refresh.', {
    runnerId: runner.id,
    pendingFrames: runner.pendingFrames.length
  });
  runner.pendingFrames = [];
  await renderRunnerFrame(runner, clockface);

  if (isRunnerActive(runner)) {
    scheduleNextFrame(runner, clockface);
  }
}

export function refreshActiveClockfaceInBackground() {
  if (!getRuntimeConfig().pixooHost || isPixooPalOff()) {
    return;
  }

  refreshActiveClockface().catch((error) => {
    console.error('Clockface refresh failed:', error);
  });
}

export async function observeActiveClockface(durationMs: number) {
  await waitForClockfaces();

  if (clockfaceRuntimeState.benchmarkCollector) {
    throw new Error('Clockface benchmark is already running.');
  }

  if (isPixooPalOff() || isClockfacesPaused()) {
    throw new Error('Clockface benchmark cannot run while PixooPal is paused.');
  }

  const runner = getActiveRunner();

  if (!runner || !isRunnerActive(runner)) {
    throw new Error('Clockface benchmark needs an active clockface runner.');
  }

  const active = getClockfaceEntry(runner.id);
  const startedAt = new Date();
  const collector: ClockfaceBenchmarkCollector = {
    runnerId: runner.id,
    startedAt: Date.now(),
    renderSamples: [],
    pushSamples: [],
    scheduler: {
      scheduled: 0,
      blockReasons: {}
    }
  };

  clockfaceRuntimeState.benchmarkCollector = collector;

  try {
    await delay(durationMs);
  } finally {
    if (clockfaceRuntimeState.benchmarkCollector === collector) {
      clockfaceRuntimeState.benchmarkCollector = undefined;
    }
  }

  const finishedAt = new Date();

  return {
    activeClockface: {
      id: active.id,
      name: active.name,
      resolution: active.instance.resolution,
      updateIntervalMs: getFrameInterval(active.instance),
      frameQueueSize: getFrameBufferSize(active.instance)
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    renderSamples: collector.renderSamples,
    pushSamples: collector.pushSamples,
    scheduler: collector.scheduler
  };
}

export async function runWithClockfacesPaused<T>(operation: () => Promise<T>) {
  const activeId = getActiveClockfaceId();

  await pauseClockfaces({ publishPreview: false });

  try {
    return await operation();
  } finally {
    clockfaceRuntimeState.clockfacesPaused = false;

    if (!disposed && activeId) {
      await startActiveClockface(activeId);
    }
  }
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

  if (isPixooPalOff()) {
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
    debugLog('Clearing pending frames before notification overlay.', {
      runnerId: runner.id,
      pendingFrames: runner.pendingFrames.length
    });
    runner.pendingFrames = [];
    runner.nextPushAt = undefined;
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
  if (isPixooPalOff()) {
    return setScreen(on);
  }

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
  await Promise.all([bundledPersistenceReady, communityClockfacesReady]);
  await Promise.all(clockfaces.map(({ instance }) => instance.ready));
  await Promise.all(clockfaces.map(({ instance }) => instance.waitForPersistence()));
}

async function refreshInstalledCommunityClockfaces() {
  const bundledIds = new Set(bundledClockfaces.map((clockface) => clockface.id));
  const installedClockfaces = await getInstalledCommunityClockfaces();
  const debugInfo = getCommunityClockfacesDebugInfo();
  console.log(
    `[PixooPal] Community clockfaces scan: dataDir=${debugInfo.dataDir}, dir=${debugInfo.communityClockfacesDir}, installed=${installedClockfaces.length}`
  );
  const communityEntries = await Promise.all(
    installedClockfaces
      .filter((clockface) => !bundledIds.has(clockface.id))
      .map(async (clockface): Promise<ClockfaceEntry | undefined> => {
        try {
          const stats = await stat(clockface.modulePath);
          const moduleUrl = `${pathToFileURL(clockface.modulePath).href}?v=${stats.mtimeMs}`;
          const module = (await import(/* @vite-ignore */ moduleUrl)) as ClockfaceModule;

          await module.default.attachPersistence(clockface.id);

          return {
            id: clockface.id,
            name: clockface.name,
            description: clockface.description,
            picture: clockface.pictureUrl,
            instance: module.default,
            source: 'community'
          };
        } catch (error) {
          console.error(`Community clockface "${clockface.id}" load failed:`, error);
          return undefined;
        }
      })
  );

  clockfaces = [
    ...bundledClockfaces,
    ...communityEntries.filter((entry): entry is ClockfaceEntry => Boolean(entry))
  ].sort((left, right) => left.name.localeCompare(right.name));
}

async function startActiveClockface(id: string) {
  if (disposed || isClockfacesPaused() || !id || getActiveRunner()?.id === id) {
    return;
  }

  const entry = getClockfaceEntry(id);
  const runner: ClockfaceRunner = {
    id,
    stopped: false,
    pendingFrames: [],
    nextFrameId: 1
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
  debugLog('Clearing pending frames while stopping active clockface.', {
    runnerId: runner.id,
    pendingFrames: runner.pendingFrames.length
  });
  runner.pendingFrames = [];
  clearTimeout(runner.timer);
  clockfaceRuntimeState.activeRunner = undefined;
  await getClockfaceEntry(runner.id).instance.stop();
}

function disposeClockfaces() {
  disposed = true;
  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.powerUnsubscribe?.();
  clockfaceRuntimeState.recoveryUnsubscribe?.();
  clockfaceRuntimeState.controlUnsubscribe?.();
  clockfaceRuntimeState.recoveryTimer = undefined;
  clockfaceRuntimeState.powerUnsubscribe = undefined;
  clockfaceRuntimeState.recoveryUnsubscribe = undefined;
  clockfaceRuntimeState.controlUnsubscribe = undefined;

  const runner = getActiveRunner();

  if (!runner) {
    return;
  }

  runner.stopped = true;
  runner.pendingFrames = [];
  clearTimeout(runner.timer);
  clockfaceRuntimeState.activeRunner = undefined;
  getClockfaceEntry(runner.id).instance.stop().catch((error) => {
    console.error('Clockface stop failed:', error);
  });
}

function scheduleNextFrame(runner: ClockfaceRunner, clockface: Clockface) {
  const blockReason = getScheduleBlockReason(runner, clockface);

  if (blockReason) {
    collectScheduleBlock(runner, blockReason);
    return;
  }

  const delayMs = getNextRenderDelay(runner, clockface);
  runner.nextScheduledDelayMs = delayMs;
  collectFrameScheduled(runner);
  runner.timer = setTimeout(() => {
    runner.timer = undefined;
    runFrame(runner, clockface).catch((error) => {
      console.error('Clockface frame failed:', error);
      scheduleNextFrame(runner, clockface);
    });
  }, delayMs);
}

async function runFrame(runner: ClockfaceRunner, clockface: Clockface) {
  if (disposed || isClockfacesPaused() || runner.stopped || getActiveRunner() !== runner) {
    return;
  }

  await renderRunnerFrame(runner, clockface);
}

async function renderRunnerFrame(runner: ClockfaceRunner, clockface: Clockface) {
  if (
    !isRunnerActive(runner) ||
    runner.pendingFrames.length >= getFrameBufferSize(clockface) ||
    runner.rendering
  ) {
    return;
  }

  runner.rendering = true;
  const frameId = runner.nextFrameId ?? 1;
  runner.nextFrameId = frameId + 1;
  const scheduledDelayMs = runner.nextScheduledDelayMs ?? null;
  runner.nextScheduledDelayMs = null;
  const renderStartedAt = Date.now();
  const queueBefore = runner.pendingFrames.length;
  let renderMs = 0;
  let displayBufferMs = 0;

  try {
    const renderStarted = Date.now();
    await clockface.render();
    renderMs = Date.now() - renderStarted;

    if (!isRunnerActive(runner)) {
      return;
    }

    const displayStarted = Date.now();
    const display = await getDisplayBuffer(clockface);
    displayBufferMs = Date.now() - displayStarted;

    if (!isRunnerActive(runner)) {
      return;
    }

    const pendingBeforePush = runner.pendingFrames.length;
    runner.pendingFrames.push({
      activeId: runner.id,
      buffer: Uint8Array.from(display.buffer),
      enqueuedAt: Date.now(),
      frameId,
      scheduledDelayMs,
      size: display.size,
      updateIntervalMs: getFrameInterval(clockface)
    });
    collectRenderSample(runner, {
      frameId,
      renderMs,
      displayBufferMs,
      renderStartGapMs: null,
      queueBefore,
      queueAfter: runner.pendingFrames.length,
      scheduledDelayMs,
      startedAtMs: renderStartedAt
    });
    debugLog('Queued rendered frame.', {
      runnerId: runner.id,
      pendingBeforePush,
      pendingAfterPush: runner.pendingFrames.length,
      size: display.size,
      updateIntervalMs: getFrameInterval(clockface)
    });
  } finally {
    runner.rendering = false;
  }

  pushPendingFramesInBackground(runner);
  scheduleNextFrame(runner, clockface);
}

function pushPendingFramesInBackground(runner: ClockfaceRunner) {
  if (runner.sending) {
    return;
  }

  runner.sending = true;

  pushPendingFrames(runner).catch((error) => {
    console.error('Clockface push failed:', error);

    if (isRunnerActive(runner)) {
      scheduleNextFrame(runner, getClockfaceEntry(runner.id).instance);
    }
  });
}

async function pushPendingFrames(runner: ClockfaceRunner) {
  try {
    while (isRunnerActive(runner) && runner.pendingFrames.length > 0) {
      const frame = runner.pendingFrames.shift();

      if (!frame) {
        continue;
      }

      const pendingAfterShift = runner.pendingFrames.length;
      debugLog('Dequeuing frame for Pixoo push.', {
        runnerId: runner.id,
        pendingAfterShift,
        frameAgeBeforeWaitMs: Date.now() - frame.enqueuedAt,
        nextPushAt: runner.nextPushAt ?? null,
        size: frame.size,
        updateIntervalMs: frame.updateIntervalMs
      });
      await waitForRunnerPushSlot(runner);
      const pushStartedAt = Date.now();
      const previousPushStartedAt = runner.lastPushStartedAt;
      runner.lastPushStartedAt = pushStartedAt;
      const pushDetails = await enqueueFramePush(runner, frame);
      runner.nextPushAt = pushStartedAt + frame.updateIntervalMs;
      collectPushSample(runner, frame, {
        pendingAfterShift,
        pushStartedAt,
        previousPushStartedAt,
        pushDurationMs: Date.now() - pushStartedAt,
        pushDetails
      });

      debugLog('Frame push completed.', {
        runnerId: runner.id,
        frameAgeAtPushStartMs: pushStartedAt - frame.enqueuedAt,
        frameAgeAtPushEndMs: Date.now() - frame.enqueuedAt,
        pushStartGapMs:
          typeof previousPushStartedAt === 'number' ? pushStartedAt - previousPushStartedAt : null,
        pushDurationMs: Date.now() - pushStartedAt,
        pendingFrames: runner.pendingFrames.length,
        nextPushAt: runner.nextPushAt
      });

      if (isRunnerActive(runner)) {
        scheduleNextFrame(runner, getClockfaceEntry(runner.id).instance);
      }
    }
  } finally {
    runner.sending = false;
    if (isRunnerActive(runner) && runner.pendingFrames.length > 0) {
      pushPendingFramesInBackground(runner);
    }
  }
}

async function enqueueFramePush(
  runner: ClockfaceRunner,
  frame: ClockfaceFrame
): Promise<ClockfaceFramePushDetails | undefined> {
  const push = clockfaceRuntimeState.pushQueue?.then(
    () => pushFrame(runner, frame),
    () => pushFrame(runner, frame)
  );
  clockfaceRuntimeState.pushQueue = push?.then(
    () => undefined,
    () => undefined
  );

  return push;
}

async function pushFrame(
  runner: ClockfaceRunner,
  frame: ClockfaceFrame
): Promise<ClockfaceFramePushDetails | undefined> {
  if (!isRunnerActive(runner) || isPixooPalOff()) {
    return;
  }

  const pushResult = await pushPixelBuffer(frame.size, frame.buffer);

  if (!isRunnerActive(runner)) {
    return {
      ...pushResult.metrics,
      previewPublishMs: 0
    };
  }

  const previewStarted = performance.now();
  publishPreviewFrame({
    activeId: frame.activeId,
    updateIntervalMs: frame.updateIntervalMs,
    preview: {
      size: frame.size,
      buffer: frame.buffer
    }
  });
  const previewPublishMs = roundPerformanceMs(performance.now() - previewStarted);

  return {
    ...pushResult.metrics,
    previewPublishMs
  };
}

async function waitForRunnerPushSlot(runner: ClockfaceRunner) {
  const remaining = Math.max(0, (runner.nextPushAt ?? 0) - Date.now());

  if (remaining > 0) {
    debugLog('Waiting for next Pixoo push slot.', {
      runnerId: runner.id,
      remainingMs: remaining
    });
    await delay(remaining);
  }
}

function getNextRenderDelay(runner: ClockfaceRunner, clockface: Clockface) {
  return getFrameInterval(clockface);
}

function getFrameBufferSize(clockface: Clockface) {
  const frameQueueSize = (clockface as ClockfaceFrameQueueProvider).frameQueueSize;

  if (frameQueueSize === undefined || !Number.isFinite(frameQueueSize)) {
    return CLOCKFACE_FRAME_BUFFER_SIZE;
  }

  return Math.max(1, Math.round(frameQueueSize));
}

function getScheduleBlockReason(runner: ClockfaceRunner, clockface: Clockface) {
  if (disposed) {
    return 'disposed';
  }

  if (isClockfacesPaused()) {
    return 'paused';
  }

  if (runner.stopped) {
    return 'stopped';
  }

  if (runner.pendingFrames.length >= getFrameBufferSize(clockface)) {
    return 'queueFull';
  }

  if (runner.rendering) {
    return 'rendering';
  }

  if (runner.timer) {
    return 'timerActive';
  }

  if (getFrameInterval(clockface) === 0) {
    return 'staticClockface';
  }

  return '';
}

function getActiveBenchmarkCollector(runner: ClockfaceRunner) {
  const collector = clockfaceRuntimeState.benchmarkCollector;
  return collector?.runnerId === runner.id ? collector : undefined;
}

function collectFrameScheduled(runner: ClockfaceRunner) {
  const collector = getActiveBenchmarkCollector(runner);

  if (!collector) {
    return;
  }

  collector.scheduler.scheduled += 1;
}

function collectScheduleBlock(runner: ClockfaceRunner, reason: string) {
  const collector = getActiveBenchmarkCollector(runner);

  if (!collector) {
    return;
  }

  collector.scheduler.blockReasons[reason] = (collector.scheduler.blockReasons[reason] ?? 0) + 1;
}

function collectRenderSample(
  runner: ClockfaceRunner,
  sample: ClockfaceRenderBenchmarkSample
) {
  const collector = getActiveBenchmarkCollector(runner);

  if (!collector) {
    return;
  }

  const renderStartGapMs =
    typeof collector.lastRenderStartedAt === 'number'
      ? sample.startedAtMs - collector.lastRenderStartedAt
      : null;
  collector.lastRenderStartedAt = sample.startedAtMs;

  collector.renderSamples.push({
    ...sample,
    renderStartGapMs,
    startedAtMs: sample.startedAtMs - collector.startedAt
  });
}

function collectPushSample(
  runner: ClockfaceRunner,
  frame: ClockfaceFrame,
  {
    pendingAfterShift,
    previousPushStartedAt,
    pushDurationMs,
    pushDetails,
    pushStartedAt
  }: {
    pendingAfterShift: number;
    previousPushStartedAt?: number;
    pushDurationMs: number;
    pushDetails?: ClockfaceFramePushDetails;
    pushStartedAt: number;
  }
) {
  const collector = getActiveBenchmarkCollector(runner);

  if (!collector) {
    return;
  }

  const pushStartGapMs =
    typeof collector.lastPushStartedAt === 'number'
      ? pushStartedAt - collector.lastPushStartedAt
      : typeof previousPushStartedAt === 'number'
        ? pushStartedAt - previousPushStartedAt
        : null;
  collector.lastPushStartedAt = pushStartedAt;

  collector.pushSamples.push({
    frameId: frame.frameId,
    queueWaitMs: pushStartedAt - frame.enqueuedAt,
    pendingAfterShift,
    pushStartGapMs,
    pushDurationMs,
    encodeMs: pushDetails?.encodeMs,
    sendMs: pushDetails?.sendMs,
    previewPublishMs: pushDetails?.previewPublishMs,
    waitReadyMs: pushDetails?.waitReadyMs,
    resetMs: pushDetails?.resetMs,
    postSendDelayMs: pushDetails?.postSendDelayMs,
    frameBytes: pushDetails?.frameBytes,
    base64Bytes: pushDetails?.base64Bytes,
    size: frame.size,
    updateIntervalMs: frame.updateIntervalMs,
    startedAtMs: pushStartedAt - collector.startedAt
  });
}

function roundPerformanceMs(value: number) {
  return Math.round(value * 100) / 100;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pauseClockfaces({ publishPreview = true }: { publishPreview?: boolean } = {}) {
  clockfaceRuntimeState.clockfacesPaused = true;
  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.recoveryTimer = undefined;
  debugLog('Pausing clockfaces.', { publishPreview });
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
  if (disposed || isPixooPalOff()) {
    return;
  }

  debugLog('Pushing service clockface frame.');
  const preview = getServiceClockfacePreview();

  await setCustomChannel();
  await pushPixelBuffer(preview.size, preview.buffer);

  publishPreviewFrame({
    activeId: getActiveClockfaceId() || SERVICE_CLOCKFACE_ID,
    updateIntervalMs: 0,
    preview
  });
}

async function scheduleServiceClockfaceRecovery(delayMs: number) {
  if (isClockfacesPaused() || isPixooPalOff()) {
    return;
  }

  debugLog('Scheduling service clockface recovery.', { delayMs });
  clockfaceRuntimeState.serviceTransition = true;
  await pauseClockfaces({ publishPreview: false });

  clearTimeout(clockfaceRuntimeState.recoveryTimer);
  clockfaceRuntimeState.recoveryTimer = setTimeout(() => {
    if (disposed || isPixooPalOff() || !getActiveClockfaceId()) {
      clockfaceRuntimeState.serviceTransition = false;
      return;
    }

    enqueueServiceClockfaceFrame()
      .then(() => {
        debugLog('Service clockface recovery frame pushed.');
        scheduleServiceClockfaceResume();
      })
      .catch((error) => {
        clockfaceRuntimeState.serviceTransition = false;
        clockfaceRuntimeState.clockfacesPaused = false;
        console.error('Clockface service recovery frame failed:', error);
        refreshActiveClockface().catch((refreshError) => {
          console.error('Clockface recovery refresh failed:', refreshError);
        });
      });
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
      buffer: new Uint8Array(size * size * 3)
    }
  });
}

function getServiceClockfacePreview() {
  const size = PIXOO_NATIVE_SIZE;
  const buffer = new Uint8Array(size * size * 3);

  drawServiceBackground(buffer, size);
  drawGear(buffer, size, Math.floor(size / 2), Math.floor(size / 2), 21, 10);

  return {
    size,
    buffer
  };
}

function drawServiceBackground(buffer: Uint8Array, size: number) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shade = 8 + Math.round((y / (size - 1)) * 16);
      setFlatPixel(buffer, size, x, y, shade, shade + 2, shade + 6);
    }
  }
}

function drawGear(
  buffer: Uint8Array,
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
  buffer: Uint8Array,
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
  const frame = (clockface as Clockface & ClockfaceFrameProvider).getFrame?.() ?? clockface.getFrame();

  if (!needsNotificationFrame()) {
    return frame;
  }

  const size = PIXOO_NATIVE_SIZE;
  const buffer =
    frame.size === size
      ? frame.buffer
      : scaleFlatBuffer(frame.buffer, frame.size, size);

  return {
    size,
    buffer: await applyNotificationOverlay(size, buffer)
  };
}

function scaleFlatBuffer(source: Uint8Array, sourceSize: number, targetSize: number) {
  const output = new Uint8Array(targetSize * targetSize * 3);

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
  const settleMs = getPixooFrameSettleMs(clockface.resolution);

  if (needsNotificationFrame()) {
    const notificationInterval =
      clockface.updateIntervalMs > 0
        ? Math.min(clockface.updateIntervalMs, NOTIFICATION_FRAME_MS)
        : NOTIFICATION_FRAME_MS;

    return notificationInterval + settleMs;
  }

  if (clockface.updateIntervalMs === 0) {
    return 0;
  }

  return clockface.updateIntervalMs + settleMs;
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
  return (
    !disposed &&
    !isClockfacesPaused() &&
    !isPixooPalOff() &&
    !runner.stopped &&
    getActiveRunner() === runner
  );
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
