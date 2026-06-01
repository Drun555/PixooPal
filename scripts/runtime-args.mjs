const DEVICE_ALIASES = new Set(['--device', '--pixoo', '--pixoo-address', '--pixoo-host']);
const PORT_ALIASES = new Set(['--webui-port', '--web-port', '--port', '-p']);

export function parseRuntimeArgs(argv) {
  const forwarded = [];
  let pixooAddress = process.env.PIXOO_DEVICE_ADDRESS ?? '';
  let webuiPort = process.env.PORT ?? '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      return { help: true, forwarded, pixooAddress, webuiPort };
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

    forwarded.push(arg);
  }

  return { help: false, forwarded, pixooAddress, webuiPort };
}

export function applyRuntimeEnv(parsed) {
  if (parsed.pixooAddress) {
    process.env.PIXOO_DEVICE_ADDRESS = parsed.pixooAddress;
  }

  if (parsed.webuiPort) {
    process.env.PORT = parsed.webuiPort;
  }

  process.env.HOST ??= '0.0.0.0';
}

export function printRuntimeHelp(command) {
  console.log(`Usage: npm run ${command} -- --device <pixoo-address> --webui-port <port>`);
  console.log('');
  console.log('Aliases: --device, --pixoo, --pixoo-address; --webui-port, --port, -p');
}
