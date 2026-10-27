import path from 'node:path';
import glob from 'glob';
import { nodeExternals } from 'rollup-plugin-node-externals';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      copyDtsFiles: true,
    }),
    {
      ...nodeExternals({
        devDeps: true,
        builtinsPrefix: 'ignore',
      }),
      enforce: 'pre',
    },
  ],
  build: {
    outDir: 'dist',
    // No source maps: @growi/logger is a small, private utility whose stack
    // frames are noise relative to the caller's. Emitting external .map files
    // also tripped @swc-node's ESM loader (spurious "failed to read input
    // source map" errors in consumers run via @swc-node/register).
    sourcemap: false,
    lib: {
      entry: glob.sync(path.resolve(__dirname, 'src/**/*.ts'), {
        ignore: '**/*.spec.ts',
      }),
      name: 'logger',
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
      },
    },
  },
});
