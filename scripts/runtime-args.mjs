const DEVICE_ALIASES = new Set(['--device', '--pixoo', '--pixoo-address', '--pixoo-host']);
const PORT_ALIASES = new Set(['--webui-port', '--web-port', '--port', '-p']);
const DEBUG_ALIASES = new Set(['--debug-logging', '--debug']);
const HOME_ASSISTANT_URL_ALIASES = new Set([
  '--home-assistant-url',
  '--home-assistant',
  '--ha-url',
  '--ha-host'
]);
const HOME_ASSISTANT_TOKEN_ALIASES = new Set(['--home-assistant-token', '--ha-token']);

export function parseRuntimeArgs(argv) {
  const forwarded = [];
  let pixooAddress = process.env.PIXOO_DEVICE_ADDRESS ?? '';
  let webuiPort = process.env.PORT ?? '5173';
  let debugLogging = process.env.DEBUG_LOGGING ?? '';
  let homeAssistantUrl = process.env.HOME_ASSISTANT_URL ?? '';
  let homeAssistantToken = process.env.HOME_ASSISTANT_TOKEN ?? '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      return {
        help: true,
        forwarded,
        pixooAddress,
        webuiPort,
        debugLogging,
        homeAssistantUrl,
        homeAssistantToken
      };
    }

    const [key, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];

    if (DEVICE_ALIASES.has(key)) {
      pixooAddress = inlineValue ?? argv[++index] ?? '';
      continue;
    }

    if (PORT_ALIASES.has(key)) {
      webuiPort = inlineValue ?? argv[++index] ?? '';
      continue;
    }

    if (DEBUG_ALIASES.has(key)) {
      if (inlineValue !== undefined) {
        debugLogging = inlineValue;
      } else if (argv[index + 1] && !argv[index + 1].startsWith('-')) {
        debugLogging = argv[++index];
      } else {
        debugLogging = 'true';
      }
      continue;
    }

    if (HOME_ASSISTANT_URL_ALIASES.has(key)) {
      homeAssistantUrl = inlineValue ?? argv[++index] ?? '';
      continue;
    }

    if (HOME_ASSISTANT_TOKEN_ALIASES.has(key)) {
      homeAssistantToken = inlineValue ?? argv[++index] ?? '';
      continue;
    }

    forwarded.push(arg);
  }

  return {
    help: false,
    forwarded,
    pixooAddress,
    webuiPort,
    debugLogging,
    homeAssistantUrl,
    homeAssistantToken
  };
}

export function applyRuntimeEnv(parsed) {
  if (parsed.pixooAddress) {
    process.env.PIXOO_DEVICE_ADDRESS = parsed.pixooAddress;
  }

  process.env.PORT = parsed.webuiPort || '5173';
  if (parsed.debugLogging) {
    process.env.DEBUG_LOGGING = parsed.debugLogging;
  }

  if (parsed.homeAssistantUrl) {
    process.env.HOME_ASSISTANT_URL = parsed.homeAssistantUrl;
  }

  if (parsed.homeAssistantToken) {
    process.env.HOME_ASSISTANT_TOKEN = parsed.homeAssistantToken;
  }

  process.env.HOST ??= '0.0.0.0';
}

export function printRuntimeHelp(command) {
  console.log(
    `Usage: npm run ${command} -- --device <pixoo-address> --webui-port <port> --home-assistant-url <url-or-ip> --home-assistant-token <token> --debug-logging true`
  );
  console.log('');
  console.log(
    'Aliases: --device, --pixoo, --pixoo-address; --webui-port, --port, -p; --home-assistant-url, --home-assistant, --ha-url, --ha-host; --home-assistant-token, --ha-token; --debug-logging, --debug'
  );
}
