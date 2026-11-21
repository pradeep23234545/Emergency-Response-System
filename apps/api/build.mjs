// Bundles the API into a single ESM file at dist/index.mjs.
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import esbuildPluginPino from 'esbuild-plugin-pino';

// esbuild-plugin-pino resolves its transports through `require`.
globalThis.require = createRequire(import.meta.url);

const appDir = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(appDir, 'dist');

await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: [path.join(appDir, 'src/index.ts')],
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  outdir,
  outExtension: { '.js': '.mjs' },
  sourcemap: 'linked',
  logLevel: 'info',
  external: ['*.node'],
  // pino logs from worker threads, so its transports are emitted as separate files.
  plugins: [esbuildPluginPino({ transports: ['pino-pretty'] })],
  // Express and friends are CommonJS; give the ESM bundle `require` and `__dirname`.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import __path from 'node:path';",
      "import __url from 'node:url';",
      'globalThis.require = __createRequire(import.meta.url);',
      'globalThis.__filename = __url.fileURLToPath(import.meta.url);',
      'globalThis.__dirname = __path.dirname(globalThis.__filename);',
    ].join('\n'),
  },
});
