import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { getRuntimeConfig } from './config';
import { observeActiveClockface, runWithClockfacesPaused } from './clockfaces';
import {
  getPixooRecoveryState,
  pushPixelBuffer,
  sendPixooCommand,
  startPixooCommandCollection,
  type PixooCommandSample
} from './pixoo';

type BenchmarkOptions = {
  frames: number;
  warmupFrames: number;
  intervalMs: number;
};

type BenchmarkSample = {
  index: number;
  generateMs: number;
  encodeMs: number;
  pushMs?: number;
  pushStartGapMs?: number | null;
  startedAtMs: number;
};

type BenchmarkRun = {
  size: 32 | 64;
  summary: BenchmarkSummary;
  samples: BenchmarkSample[];
};

type BenchmarkSummary = {
  generateMs: ReturnType<typeof summarize>;
  encodeMs: ReturnType<typeof summarize>;
  pushMs: ReturnType<typeof summarize>;
  pushStartGapMs: ReturnType<typeof summarize>;
};

const DEFAULT_OPTIONS: BenchmarkOptions = {
  frames: 30,
  warmupFrames: 2,
  intervalMs: 120
};
const DEFAULT_CLOCKFACE_BENCHMARK_OPTIONS = {
  durationMs: 20_000
};

let activeBenchmark: Promise<unknown> | undefined;
let activeClockfaceBenchmark: Promise<unknown> | undefined;

export function getBenchmarkInfo() {
  return {
    ok: true,
    endpoint: '/benchmark',
    method: 'POST',
    defaults: DEFAULT_OPTIONS,
    options: {
      frames: '1..120 measured frames',
      warmupFrames: '0..10 unmeasured Pixoo frames before measured run',
      intervalMs: '0..2000 delay between Pixoo pushes'
    },
    example: {
      frames: 30,
      warmupFrames: 2,
      intervalMs: 120
    },
    runs: [64, 32]
  };
}

export async function runBenchmark(payload: unknown) {
  if (activeBenchmark || activeClockfaceBenchmark) {
    throw new Error('Benchmark is already running.');
  }

  const options = parseBenchmarkOptions(payload);
  const benchmark = runBenchmarkExclusive(options).finally(() => {
    activeBenchmark = undefined;
  });

  activeBenchmark = benchmark;
  return benchmark;
}

export async function runClockfaceBenchmark(payload: unknown) {
  if (activeBenchmark || activeClockfaceBenchmark) {
    throw new Error('Clockface benchmark is already running.');
  }

  const options = parseClockfaceBenchmarkOptions(payload);
  const benchmark = runClockfaceBenchmarkExclusive(options).finally(() => {
    activeClockfaceBenchmark = undefined;
  });

  activeClockfaceBenchmark = benchmark;
  return benchmark;
}

async function runClockfaceBenchmarkExclusive(options: { durationMs: number }) {
  const startedAt = new Date();
  const started = performance.now();
  const recoveryBefore = getPixooRecoveryState();
  const config = getRuntimeConfig();
  const stopCommandCollection = startPixooCommandCollection();
  let commands: PixooCommandSample[] = [];

  try {
    const observed = await observeActiveClockface(options.durationMs);
    commands = stopCommandCollection();
    const finishedAt = new Date();

    return {
      ok: true,
      options,
      activeClockface: observed.activeClockface,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: round(performance.now() - started),
      server: getServerInfo(),
      pixoo: {
        host: config.pixooHost || null,
        postUrl: config.pixooPostUrl || null,
        recoveryBefore,
        recoveryAfter: getPixooRecoveryState()
      },
      summary: {
        renderMs: summarize(observed.renderSamples.map((sample) => sample.renderMs)),
        displayBufferMs: summarize(observed.renderSamples.map((sample) => sample.displayBufferMs)),
        renderStartGapMs: summarize(
          observed.renderSamples.map((sample) => sample.renderStartGapMs).filter(isNumber)
        ),
        queueWaitMs: summarize(observed.pushSamples.map((sample) => sample.queueWaitMs)),
        pushDurationMs: summarize(observed.pushSamples.map((sample) => sample.pushDurationMs)),
        encodeMs: summarize(observed.pushSamples.map((sample) => sample.encodeMs).filter(isNumber)),
        sendMs: summarize(observed.pushSamples.map((sample) => sample.sendMs).filter(isNumber)),
        previewPublishMs: summarize(
          observed.pushSamples.map((sample) => sample.previewPublishMs).filter(isNumber)
        ),
        waitReadyMs: summarize(
          observed.pushSamples.map((sample) => sample.waitReadyMs).filter(isNumber)
        ),
        resetMs: summarize(observed.pushSamples.map((sample) => sample.resetMs).filter(isNumber)),
        frameBytes: summarize(
          observed.pushSamples.map((sample) => sample.frameBytes).filter(isNumber)
        ),
        base64Bytes: summarize(
          observed.pushSamples.map((sample) => sample.base64Bytes).filter(isNumber)
        ),
        pushStartGapMs: summarize(
          observed.pushSamples.map((sample) => sample.pushStartGapMs).filter(isNumber)
        ),
        counts: {
          renderedFrames: observed.renderSamples.length,
          pushedFrames: observed.pushSamples.length,
          scheduledFrames: observed.scheduler.scheduled,
          schedulerBlocks: observed.scheduler.blockReasons,
          pixooCommands: commands.length,
          pixooCommandCounts: summarizeCommands(commands)
        }
      },
      samples: {
        render: observed.renderSamples,
        push: observed.pushSamples
      },
      commands
    };
  } catch (error) {
    commands = stopCommandCollection();
    throw error;
  }
}

async function runBenchmarkExclusive(options: BenchmarkOptions) {
  const startedAt = new Date();
  const started = performance.now();
  const runs: BenchmarkRun[] = [];
  const recoveryBefore = getPixooRecoveryState();
  const config = getRuntimeConfig();

  const operation = async () => {
    await sendPixooCommand({ Command: 'Channel/GetAllConf' });

    for (const size of [64, 32] as const) {
      for (let index = 0; index < options.warmupFrames; index += 1) {
        await pushPixelBuffer(size, generateFrame(size, -index - 1));
        await delay(options.intervalMs);
      }

      const samples: BenchmarkSample[] = [];
      let previousPushStartedAt: number | undefined;

      for (let index = 0; index < options.frames; index += 1) {
        const frameStarted = performance.now();
        const generateStarted = performance.now();
        const buffer = generateFrame(size, index);
        const generateMs = elapsedSince(generateStarted);

        const encodeStarted = performance.now();
        Buffer.from(buffer).toString('base64');
        const encodeMs = elapsedSince(encodeStarted);

        const pushStarted = performance.now();
        const sample: BenchmarkSample = {
          index,
          generateMs,
          encodeMs,
          pushStartGapMs:
            previousPushStartedAt === undefined ? null : round(pushStarted - previousPushStartedAt),
          startedAtMs: round(frameStarted - started)
        };
        previousPushStartedAt = pushStarted;

        await pushPixelBuffer(size, buffer);
        sample.pushMs = elapsedSince(pushStarted);

        samples.push(sample);
        await delay(options.intervalMs);
      }

      runs.push({
        size,
        summary: summarizeSamples(samples),
        samples
      });
    }
  };

  await runWithClockfacesPaused(operation);

  const finishedAt = new Date();

  return {
    ok: true,
    options,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: round(performance.now() - started),
    server: getServerInfo(),
    pixoo: {
      host: config.pixooHost || null,
      postUrl: config.pixooPostUrl || null,
      recoveryBefore,
      recoveryAfter: getPixooRecoveryState()
    },
    runs
  };
}

function parseBenchmarkOptions(payload: unknown): BenchmarkOptions {
  const record = isRecord(payload) ? payload : {};

  return {
    frames: clampInt(record.frames, DEFAULT_OPTIONS.frames, 1, 120),
    warmupFrames: clampInt(record.warmupFrames, DEFAULT_OPTIONS.warmupFrames, 0, 10),
    intervalMs: clampInt(record.intervalMs, DEFAULT_OPTIONS.intervalMs, 0, 2000)
  };
}

function parseClockfaceBenchmarkOptions(payload: unknown) {
  const record = isRecord(payload) ? payload : {};

  return {
    durationMs: clampInt(
      record.durationMs,
      DEFAULT_CLOCKFACE_BENCHMARK_OPTIONS.durationMs,
      1_000,
      120_000
    )
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(number)));
}

function generateFrame(size: number, frameIndex: number) {
  const buffer = new Uint8Array(size * size * 3);
  const center = (size - 1) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 3;
      const wave = (x * 5 + y * 7 + frameIndex * 11) % 256;
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.max(0, 255 - Math.abs(((distance * 12 + frameIndex * 9) % 256) - 128) * 2);

      buffer[offset] = wave;
      buffer[offset + 1] = (wave + ring) % 256;
      buffer[offset + 2] = Math.max(wave, ring);
    }
  }

  return buffer;
}

function summarizeSamples(samples: BenchmarkSample[]): BenchmarkSummary {
  return {
    generateMs: summarize(samples.map((sample) => sample.generateMs)),
    encodeMs: summarize(samples.map((sample) => sample.encodeMs)),
    pushMs: summarize(samples.map((sample) => sample.pushMs).filter(isNumber)),
    pushStartGapMs: summarize(samples.map((sample) => sample.pushStartGapMs).filter(isNumber))
  };
}

function summarizeCommands(samples: PixooCommandSample[]) {
  const groups: Record<
    string,
    {
      count: number;
      ok: number;
      error: number;
      durationMs: number[];
    }
  > = {};

  for (const sample of samples) {
    groups[sample.command] ??= {
      count: 0,
      ok: 0,
      error: 0,
      durationMs: []
    };
    groups[sample.command].count += 1;
    groups[sample.command].durationMs.push(sample.durationMs);

    if (sample.ok) {
      groups[sample.command].ok += 1;
    } else {
      groups[sample.command].error += 1;
    }
  }

  return Object.fromEntries(
    Object.entries(groups).map(([command, group]) => [
      command,
      {
        count: group.count,
        ok: group.ok,
        error: group.error,
        durationMs: summarize(group.durationMs)
      }
    ])
  );
}

function summarize(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    avg: round(total / sorted.length),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1]
  };
}

function percentile(sorted: number[], fraction: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function getServerInfo() {
  return {
    nodeVersion: process.version,
    platform: platform(),
    release: release(),
    cpuCount: cpus().length,
    loadavg: loadavg().map(round),
    memory: {
      free: freemem(),
      total: totalmem()
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function elapsedSince(startedAt: number) {
  return round(performance.now() - startedAt);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
