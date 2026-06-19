import { spawn } from 'node:child_process';
import { join } from 'node:path';
import './load-env.mjs';
import { applyRuntimeEnv, parseRuntimeArgs, printRuntimeHelp } from './runtime-args.mjs';

const parsed = parseRuntimeArgs(process.argv.slice(2));

if (parsed.help) {
  printRuntimeHelp('dev');
  process.exit(0);
}

applyRuntimeEnv(parsed);

const args = [join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), 'dev', '--host', process.env.HOST ?? '0.0.0.0'];

if (process.env.HTTP_PORT) {
  args.push('--port', process.env.HTTP_PORT);
}

args.push(...parsed.forwarded);

const child = spawn(process.execPath, args, {
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
