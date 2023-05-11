import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts(),
  ],
  build: {
    outDir: 'dist/client',
    sourcemap: true,
    lib: {
      entry: {
        index: 'src/client/index.ts',
      },
      name: 'remark-attachment-refs-libs',
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'bunyan',
        'universal-bunyan',
        'react',
        'react-dom',
        /^hast-.*/,
        /^unist-.*/,
        /^@growi\/.*/,
      ],
    },
  },
});
