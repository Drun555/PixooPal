type HomeAssistantHandshake = {
  entryId: string;
  renderPath: string;
  renderUrl?: string;
};

type HomeAssistantState = {
  entryId: string;
  renderPath: string;
  renderUrl: string;
  connectedAt: string;
};

const DEFAULT_SUPERVISOR_CORE_URL = 'http://supervisor/core';

const homeAssistantState = getHomeAssistantState();

export function registerHomeAssistantConnection(handshake: HomeAssistantHandshake) {
  const entryId = normalizeString(handshake.entryId);
  const renderPath = normalizeRenderPath(handshake.renderPath);
  const renderUrl = normalizeString(handshake.renderUrl) || getDefaultRenderUrl(renderPath);

  if (!entryId) {
    throw new Error('Home Assistant entryId is required.');
  }

  if (!renderPath) {
    throw new Error('Home Assistant renderPath is required.');
  }

  if (!renderUrl) {
    throw new Error('Home Assistant render URL is not configured.');
  }

  homeAssistantState.connection = {
    entryId,
    renderPath,
    renderUrl,
    connectedAt: new Date().toISOString()
  };

  return getHomeAssistantConnectionState();
}

export function getHomeAssistantConnectionState() {
  return {
    connected: Boolean(homeAssistantState.connection),
    connection: homeAssistantState.connection ?? null
  };
}

export function getClockfaceHomeAssistantClient() {
  return {
    get connected() {
      return Boolean(homeAssistantState.connection);
    },
    renderJinja
  };
}

export async function renderJinja(template: string, variables: Record<string, unknown> = {}) {
  const connection = homeAssistantState.connection;

  if (!connection) {
    throw new Error('Home Assistant integration is not connected.');
  }

  const response = await fetch(connection.renderUrl, {
    method: 'POST',
    headers: {
      ...getHomeAssistantRequestHeaders(),
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      template,
      variables
    })
  });
  const body = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    throw new Error(`Home Assistant returned HTTP ${response.status}.`);
  }

  if (!isRecord(body) || body.ok === false) {
    throw new Error(String(isRecord(body) ? body.message : '') || 'Home Assistant template render failed.');
  }

  return String(body.result ?? '');
}

function getDefaultRenderUrl(renderPath: string) {
  const configuredUrl = normalizeString(process.env.HOME_ASSISTANT_URL);

  if (configuredUrl) {
    return `${configuredUrl.replace(/\/+$/, '')}${renderPath}`;
  }

  if (process.env.SUPERVISOR_TOKEN) {
    return `${DEFAULT_SUPERVISOR_CORE_URL}${renderPath}`;
  }

  return '';
}

function getHomeAssistantRequestHeaders() {
  const headers: Record<string, string> = {};
  const supervisorToken = normalizeString(process.env.SUPERVISOR_TOKEN);
  const homeAssistantToken = normalizeString(process.env.HOME_ASSISTANT_TOKEN);

  if (supervisorToken) {
    headers.authorization = `Bearer ${supervisorToken}`;
  } else if (homeAssistantToken) {
    headers.authorization = `Bearer ${homeAssistantToken}`;
  }

  return headers;
}

function normalizeRenderPath(value: string) {
  const path = normalizeString(value);

  if (!path) {
    return '';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getHomeAssistantState() {
  const key = Symbol.for('pixoopal.homeAssistant');
  const globalScope = globalThis as typeof globalThis & {
    [key]?: {
      connection?: HomeAssistantState;
    };
  };

  globalScope[key] ??= {};
  return globalScope[key];
}
