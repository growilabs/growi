import path from 'node:path';
import glob from 'glob';
import { nodeExternals } from 'rollup-plugin-node-externals';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
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
    sourcemap: true,
    lib: {
      entry: glob.sync(path.resolve(__dirname, 'src/**/*.ts'), {
        // `src/testing/**` is an in-memory integration-test harness (tasks
        // 7.2-7.5), not part of this package's public surface -- excluding
        // it keeps its `node:crypto` usage out of `dist/`, consistent with
        // the "only src/signature/ touches node:crypto" boundary. The glob
        // pattern above is resolved to an absolute path, so the ignore
        // pattern must be absolute too, or it silently fails to match.
        ignore: [
          '**/*.{spec,test}.ts',
          path.resolve(__dirname, 'src/testing/**'),
        ],
      }),
      name: 'chat-libs',
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
