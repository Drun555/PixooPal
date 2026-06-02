import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getDataPath } from './dataDir';

export type PixooPalControlState = {
  pixooPalOff: boolean;
};

type ControlListener = (state: PixooPalControlState) => void | Promise<void>;

const CONTROL_FILE = getDataPath('.pixoopal-control.json');

const controlState = getInitialControlState();
const listeners = new Set<ControlListener>();

export function getPixooPalControlState(): PixooPalControlState {
  return { ...controlState };
}

export function isPixooPalOff() {
  return controlState.pixooPalOff;
}

export function setPixooPalOff(pixooPalOff: boolean) {
  if (controlState.pixooPalOff === pixooPalOff) {
    return getPixooPalControlState();
  }

  controlState.pixooPalOff = pixooPalOff;
  writeControlState();
  publishControlState();
  return getPixooPalControlState();
}

export function subscribePixooPalControl(listener: ControlListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function publishControlState() {
  const state = getPixooPalControlState();

  for (const listener of listeners) {
    Promise.resolve(listener(state)).catch((error) => {
      console.error('PixooPal control listener failed:', error);
    });
  }
}

function getInitialControlState(): PixooPalControlState {
  if (!existsSync(CONTROL_FILE)) {
    return { pixooPalOff: false };
  }

  try {
    const value = JSON.parse(readFileSync(CONTROL_FILE, 'utf-8')) as unknown;

    if (isRecord(value)) {
      return {
        pixooPalOff: value.pixooPalOff === true
      };
    }
  } catch (error) {
    console.warn(`Could not read PixooPal control state from ${CONTROL_FILE}:`, error);
  }

  return { pixooPalOff: false };
}

function writeControlState() {
  writeFileSync(CONTROL_FILE, `${JSON.stringify(controlState, null, 2)}\n`, 'utf-8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
