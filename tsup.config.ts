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
  // Node config — core + node layer + winston adapter
  {
    entry: {
      core: 'src/core/index.ts',
      node: 'src/node/index.ts',
      winston: 'src/node/winston.ts',
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
]);
