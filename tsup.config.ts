import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser config — resolves browser-specific platform shims
  {
    entry: { browser: 'src/browser/index.ts' },
    platform: 'browser',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: [],
    // clean: false — cleaning is owned by the build script's `npm run clean &&` prefix,
    // so neither config wipes the other's output.
    clean: false,
    outExtension({ format }) {
      return { js: format === 'esm' ? '.mjs' : '.cjs' };
    },
  },
  // Node config — node layer only (core is an internal implementation detail)
  {
    entry: {
      node: 'src/node/index.ts',
    },
    platform: 'node',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: [],
    clean: false,
    outExtension({ format }) {
      return { js: format === 'esm' ? '.mjs' : '.cjs' };
    },
  },
  // Winston adapter — separate config so `observe-js` stays external (self-reference)
  // and is not inlined; `dist/winston.{cjs,mjs}` emits a bare require/import that
  // resolves at runtime to the same module instance the host loaded, giving one
  // shared `_initialized`/`_batcher` singleton across both subpath bundles.
  {
    entry: { winston: 'src/node/winston.ts' },
    platform: 'node',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ['observe-js'],
    clean: false,
    outExtension({ format }) {
      return { js: format === 'esm' ? '.mjs' : '.cjs' };
    },
  },
]);
