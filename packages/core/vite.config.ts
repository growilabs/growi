import glob from 'glob';
import { nodeExternals } from 'rollup-plugin-node-externals';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      copyDtsFiles: true,
      // TypeScript 6/7 no longer infers rootDir as the common source dir, so
      // declarations would emit under dist/src/ (breaking the `types` entry).
      // Scope the dts program to src (tsconfig also includes test/) and pin
      // rootDir so declarations stay at dist/.
      include: ['src/**/*.ts'],
      compilerOptions: {
        rootDir: 'src',
      },
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
      entry: glob.sync('src/**/*.ts', {
        cwd: __dirname,
        absolute: true,
        ignore: '**/*.spec.ts',
      }),
      name: 'core-libs',
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
