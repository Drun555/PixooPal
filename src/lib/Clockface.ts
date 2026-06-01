import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

export type ClockfaceInputType =
  | 'button'
  | 'colorpicker'
  | 'input-text'
  | 'input-num'
  | 'input-file'
  | 'select';

export type ClockfaceData = Record<string, string>;
export type ClockfaceInputOption = {
  value: string;
  label: string;
};
export type ClockfacePersistedState = Record<string, unknown>;
export type ClockfacePixel = [number, number, number];
export type ClockfacePixelBuffer = ClockfacePixel[];
export type ClockfaceFileInputValue = {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
};
export type ClockfaceInputValue = string | ClockfaceFileInputValue;
export type ClockfacePersistence = {
  readonly state: ClockfacePersistedState;
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  update(values: ClockfacePersistedState): void;
};

export type ClockfaceContext = {
  resolution: number;
  data: ClockfaceData;
  inputs: ClockfaceInput[];
  buffer: ClockfacePixelBuffer;
  persistence: ClockfacePersistence;
};

export type ClockfaceInputSubmitFunction = (
  value: ClockfaceInputValue,
  context: ClockfaceContext
) => void | Promise<void>;

export type ClockfaceInput = {
  type: ClockfaceInputType;
  id: string;
  friendlyName: string;
  options?: ClockfaceInputOption[];
  accept?: string;
  min?: number;
  max?: number;
  step?: number;
  isSetting?: boolean;
  onSubmit: ClockfaceInputSubmitFunction;
};
export type ClockfaceInputRow = ClockfaceInput | ClockfaceInput[];

export type ClockfaceLifecycleFunction = (context: ClockfaceContext) => void | Promise<void>;
export type ClockfaceUpdateIntervalFunction = (context: ClockfaceContext) => number;

export type ClockfaceOptions = {
  resolution: number;
  data: ClockfaceData;
  inputs: ClockfaceInputRow[];
  updateIntervalMs?: number;
  getUpdateIntervalMs?: ClockfaceUpdateIntervalFunction;
  persistedState?: ClockfacePersistedState;
  init: ClockfaceLifecycleFunction;
  main: ClockfaceLifecycleFunction;
  start?: ClockfaceLifecycleFunction;
  stop?: ClockfaceLifecycleFunction;
};

export class Clockface {
  readonly resolution: number;
  readonly data: ClockfaceData;
  readonly inputs: ClockfaceInput[];
  readonly inputRows: ClockfaceInput[][];
  readonly buffer: ClockfacePixelBuffer;
  readonly ready: Promise<void>;
  private readonly defaultUpdateIntervalMs: number;
  private readonly getUpdateIntervalMsFn?: ClockfaceUpdateIntervalFunction;

  private readonly initFn: ClockfaceLifecycleFunction;
  private readonly mainFn: ClockfaceLifecycleFunction;
  private readonly startFn?: ClockfaceLifecycleFunction;
  private readonly stopFn?: ClockfaceLifecycleFunction;
  private persistenceKey = '';
  private persistedState: ClockfacePersistedState;
  private persistenceReady: Promise<void>;

  constructor({
    resolution,
    data,
    inputs,
    updateIntervalMs = 0,
    getUpdateIntervalMs,
    persistedState = {},
    init,
    main,
    start,
    stop
  }: ClockfaceOptions) {
    this.resolution = resolution;
    this.data = data;
    this.inputRows = normalizeInputRows(inputs);
    this.inputs = this.inputRows.flat();
    this.buffer = createBuffer(resolution);
    this.defaultUpdateIntervalMs = normalizeUpdateInterval(updateIntervalMs);
    this.getUpdateIntervalMsFn = getUpdateIntervalMs;
    this.initFn = init;
    this.mainFn = main;
    this.startFn = start;
    this.stopFn = stop;
    this.persistedState = { ...persistedState };
    this.ready = this.run();
    this.persistenceReady = this.ready;
  }

  get context(): ClockfaceContext {
    return {
      resolution: this.resolution,
      data: this.data,
      inputs: this.inputs,
      buffer: this.buffer,
      persistence: this.persistence
    };
  }

  get flatBuffer() {
    return this.buffer.flat();
  }

  get updateIntervalMs() {
    return normalizeUpdateInterval(this.getUpdateIntervalMsFn?.(this.context) ?? this.defaultUpdateIntervalMs);
  }

  get persistence(): ClockfacePersistence {
    const clockface = this;

    return {
      get state() {
        return clockface.persistedState;
      },
      get: <T>(key: string, fallback: T) => {
        const value = this.persistedState[key];
        return value === undefined ? fallback : (value as T);
      },
      set: (key: string, value: unknown) => {
        this.persistedState = {
          ...this.persistedState,
          [key]: value
        };
        this.persist();
      },
      update: (values: ClockfacePersistedState) => {
        this.persistedState = {
          ...this.persistedState,
          ...values
        };
        this.persist();
      }
    };
  }

  async attachPersistence(key: string) {
    this.persistenceKey = key;

    this.persistenceReady = this.ready.then(async () => {
      const persisted = readPersistedClockface(key);
      Object.assign(this.data, persisted.data);
      this.persistedState = { ...this.persistedState, ...persisted.state };
      await this.initFn(this.context);
      await this.mainFn(this.context);
    });

    await this.persistenceReady;
  }

  async waitForPersistence() {
    await this.persistenceReady;
  }

  async submitInput(id: string, value: ClockfaceInputValue) {
    await this.waitForPersistence();

    const input = this.inputs.find((item) => item.id === id);

    if (!input) {
      throw new Error(`Clockface input "${id}" was not found.`);
    }

    await input.onSubmit(value, this.context);
    this.persist();
  }

  async render() {
    await this.waitForPersistence();
    await this.mainFn(this.context);
  }

  async start() {
    await this.waitForPersistence();
    await this.startFn?.(this.context);
  }

  async stop() {
    await this.waitForPersistence();
    await this.stopFn?.(this.context);
  }

  private async run() {
    await this.initFn(this.context);
    await this.mainFn(this.context);
  }

  private persist() {
    if (!this.persistenceKey) {
      return;
    }

    writePersistedClockface(this.persistenceKey, {
      data: this.data,
      state: this.persistedState
    });
  }
}

function createBuffer(resolution: number): ClockfacePixelBuffer {
  if (!Number.isInteger(resolution) || resolution <= 0) {
    throw new Error('Clockface resolution must be a positive integer.');
  }

  return Array.from({ length: resolution * resolution }, () => [0, 0, 0]);
}

function normalizeInputRows(inputs: ClockfaceInputRow[]) {
  return inputs.map((input) => (Array.isArray(input) ? input : [input]));
}

function normalizeUpdateInterval(updateIntervalMs: number) {
  if (!Number.isFinite(updateIntervalMs) || updateIntervalMs <= 0) {
    return 0;
  }

  return Math.max(50, Math.round(updateIntervalMs));
}

type PersistedClockfaceEntry = {
  data?: ClockfaceData;
  state?: ClockfacePersistedState;
};

type PersistedClockfacesFile = Record<string, PersistedClockfaceEntry>;

const PERSISTENCE_FILE = join(
  env.PIXOOPAL_DATA_DIR || (existsSync('/data') ? '/data' : process.cwd()),
  '.pixoopal-clockfaces.json'
);

function readPersistedClockface(key: string) {
  const file = readPersistenceFile();
  const entry = file[key] ?? {};

  return {
    data: sanitizeData(entry.data),
    state: sanitizeState(entry.state)
  };
}

function writePersistedClockface(key: string, entry: Required<PersistedClockfaceEntry>) {
  const file = readPersistenceFile();
  file[key] = {
    data: { ...entry.data },
    state: { ...entry.state }
  };

  writeFileSync(PERSISTENCE_FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
}

function readPersistenceFile(): PersistedClockfacesFile {
  if (!existsSync(PERSISTENCE_FILE)) {
    return {};
  }

  try {
    const value = JSON.parse(readFileSync(PERSISTENCE_FILE, 'utf-8')) as unknown;
    return isRecord(value) ? (value as PersistedClockfacesFile) : {};
  } catch {
    return {};
  }
}

function sanitizeData(value: unknown): ClockfaceData {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function sanitizeState(value: unknown): ClockfacePersistedState {
  return isRecord(value) ? { ...value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
