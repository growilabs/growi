import { nodeExternals } from 'rollup-plugin-node-externals';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      entryRoot: 'src/server',
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
    outDir: 'dist/server',
    sourcemap: true,
    lib: {
      entry: ['src/server/index.ts'],
      name: 'remark-lsx-libs',
      formats: ['cjs'],
    },
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src/server',
      },
    },
  },
});
