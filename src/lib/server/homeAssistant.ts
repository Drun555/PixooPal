import { getRuntimeConfig } from './config';

type HomeAssistantConnection = {
  configured: boolean;
  supervisor: boolean;
  token: string;
  url: string;
};

export type HomeAssistantStatus = {
  checkedAt: string | null;
  configured: boolean;
  connected: boolean;
  message: string;
  supervisor: boolean;
  tokenConfigured: boolean;
  url: string;
};

const TEMPLATE_PATH = '/api/template';
const PROBE_TEMPLATE = '{{ 1 + 1 }}';
const REQUEST_TIMEOUT_MS = 5000;

let lastStatus: HomeAssistantStatus | null = null;
let lastStatusSignature = '';

export async function getHomeAssistantStatus() {
  return probeHomeAssistantConnection();
}

export async function probeHomeAssistantConnection(): Promise<HomeAssistantStatus> {
  const connection = getHomeAssistantConnection();
  const checkedAt = new Date().toISOString();

  if (!connection.configured) {
    return setHomeAssistantStatus({
      checkedAt,
      configured: false,
      connected: false,
      message: getMissingConfigurationMessage(connection),
      supervisor: connection.supervisor,
      tokenConfigured: Boolean(connection.token),
      url: connection.url
    });
  }

  const startedAt = Date.now();

  try {
    const result = await renderJinja(PROBE_TEMPLATE, {}, connection);

    return setHomeAssistantStatus({
      checkedAt,
      configured: true,
      connected: true,
      message: `Home Assistant Jinja probe succeeded: ${result}`,
      supervisor: connection.supervisor,
      tokenConfigured: true,
      url: connection.url
    }, Date.now() - startedAt);
  } catch (error) {
    return setHomeAssistantStatus({
      checkedAt,
      configured: true,
      connected: false,
      message: error instanceof Error ? error.message : String(error),
      supervisor: connection.supervisor,
      tokenConfigured: true,
      url: connection.url
    }, Date.now() - startedAt);
  }
}

export function getHomeAssistantConnectionState() {
  const connection = getHomeAssistantConnection();

  return {
    configured: connection.configured,
    connected: lastStatus?.connected ?? false,
    connection: connection.url
      ? {
          supervisor: connection.supervisor,
          url: connection.url
        }
      : null
  };
}

export function getClockfaceHomeAssistantClient() {
  return {
    get connected() {
      return lastStatus?.connected ?? getHomeAssistantConnection().configured;
    },
    renderJinja,
    async fetchBinary(url: string) {
      const connection = getHomeAssistantConnection();

      if (!connection.configured) {
        throw new Error(getMissingConfigurationMessage(connection));
      }

      const resolvedUrl = resolveHomeAssistantUrl(url);
      const response = await fetch(resolvedUrl, {
        headers: isHomeAssistantUrl(resolvedUrl)
          ? {
              authorization: `Bearer ${connection.token}`
            }
          : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(
          `Home Assistant returned HTTP ${response.status}${responseText ? `: ${responseText}` : ''}.`
        );
      }

      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        type: response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
      };
    },
    async callService(
      domain: string,
      service: string,
      data: Record<string, unknown> = {},
      options: { returnResponse?: boolean } = {}
    ) {
      return callService(domain, service, data, options);
    }
  };
}

export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  options: { returnResponse?: boolean } = {},
  existingConnection?: HomeAssistantConnection
) {
  const connection = existingConnection ?? getHomeAssistantConnection();

  if (!connection.configured) {
    throw new Error(getMissingConfigurationMessage(connection));
  }

  const safeDomain = normalizeServicePathPart(domain, 'domain');
  const safeService = normalizeServicePathPart(service, 'service');
  const response = await fetch(
    resolveHomeAssistantUrl(
      `/api/services/${safeDomain}/${safeService}${options.returnResponse ? '?return_response' : ''}`
    ),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify(data)
    }
  );
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Home Assistant returned HTTP ${response.status}${responseText ? `: ${responseText}` : ''}.`
    );
  }

  return responseText ? JSON.parse(responseText) : null;
}

export async function renderJinja(
  template: string,
  variables: Record<string, unknown> = {},
  existingConnection?: HomeAssistantConnection
) {
  const connection = existingConnection ?? getHomeAssistantConnection();

  if (!connection.configured) {
    throw new Error(getMissingConfigurationMessage(connection));
  }

  const body: Record<string, unknown> = { template };
  if (Object.keys(variables).length > 0) {
    body.variables = variables;
  }

  const response = await fetch(connection.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.token}`,
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify(body)
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Home Assistant returned HTTP ${response.status}${responseText ? `: ${responseText}` : ''}.`
    );
  }

  return responseText;
}

function getHomeAssistantConnection(): HomeAssistantConnection {
  const config = getRuntimeConfig();
  const supervisorToken = normalizeString(process.env.SUPERVISOR_TOKEN);

  if (supervisorToken) {
    return {
      configured: true,
      supervisor: true,
      token: supervisorToken,
      url: `${config.homeAssistantUrl}${TEMPLATE_PATH}`
    };
  }

  const token = normalizeString(process.env.HOME_ASSISTANT_TOKEN);

  return {
    configured: Boolean(config.homeAssistantUrl && token),
    supervisor: false,
    token,
    url: config.homeAssistantUrl ? `${config.homeAssistantUrl}${TEMPLATE_PATH}` : ''
  };
}

function resolveHomeAssistantUrl(url: string) {
  const normalized = normalizeString(url);

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const baseUrl = getRuntimeConfig().homeAssistantUrl.replace(/\/+$/, '');
  const path = normalized.startsWith('/') ? normalized : `/${normalized}`;

  return `${baseUrl}${path}`;
}

function isHomeAssistantUrl(url: string) {
  try {
    return new URL(url).origin === new URL(getRuntimeConfig().homeAssistantUrl).origin;
  } catch {
    return false;
  }
}

function normalizeServicePathPart(value: string, label: string) {
  const normalized = normalizeString(value);

  if (!/^[a-z0-9_]+$/i.test(normalized)) {
    throw new Error(`Home Assistant service ${label} is invalid.`);
  }

  return normalized;
}

function setHomeAssistantStatus(status: HomeAssistantStatus, durationMs = 0) {
  lastStatus = status;

  const signature = `${status.configured}|${status.connected}|${status.url}|${status.message}`;
  if (signature !== lastStatusSignature) {
    lastStatusSignature = signature;
    const payload = {
      url: status.url || '(empty)',
      supervisor: status.supervisor,
      tokenConfigured: status.tokenConfigured,
      message: status.message,
      durationMs
    };

    if (status.connected) {
      console.log('[PixooPal] Home Assistant Jinja probe succeeded.', payload);
    } else if (status.configured) {
      console.warn('[PixooPal] Home Assistant Jinja probe failed.', payload);
    } else {
      console.log('[PixooPal] Home Assistant Jinja is not configured.', payload);
    }
  }

  return status;
}

function getMissingConfigurationMessage(connection: HomeAssistantConnection) {
  if (!connection.url) {
    return 'Home Assistant URL is not configured.';
  }

  if (!connection.token) {
    return 'Home Assistant token is not configured.';
  }

  return 'Home Assistant is not configured.';
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
