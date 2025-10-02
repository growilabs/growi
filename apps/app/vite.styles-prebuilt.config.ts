import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'src/styles/prebuilt',
    rollupOptions: {
      input: ['/src/styles/vendor.scss'],
      output: {
        assetFileNames: '[name].[ext]', // not attach hash
      },
    },
  },
});
