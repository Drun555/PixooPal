import { build } from 'vite';

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: 'src/lib/server/mqtt/runtime.ts',
    outDir: 'scripts/runtime',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'mitm-mqtt-broker.mjs',
        format: 'es'
      }
    }
  }
});

