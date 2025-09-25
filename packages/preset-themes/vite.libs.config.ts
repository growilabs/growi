import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [dts({ copyDtsFiles: true })],
  build: {
    outDir: 'dist/libs',
    sourcemap: true,
    copyPublicDir: false,
    lib: {
      entry: 'src/index.ts',
      name: 'preset-themes-libs',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: [],
    },
  },
});
