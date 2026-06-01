import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { applyRuntimeEnv, parseRuntimeArgs, printRuntimeHelp } from './runtime-args.mjs';

const parsed = parseRuntimeArgs(process.argv.slice(2));

if (parsed.help) {
  printRuntimeHelp('start');
  process.exit(0);
}

if (!existsSync('build')) {
  console.error('Production build not found. Run `npm run build` first.');
  process.exit(1);
}

applyRuntimeEnv(parsed);

const child = spawn(process.execPath, ['scripts/server.mjs', ...parsed.forwarded], {
  env: process.env,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
