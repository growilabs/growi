import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

// Collect all src/**/*.vendor-styles.ts as entry points
const entries = fs
  .globSync('src/**/*.vendor-styles.ts', { cwd: __dirname })
  .reduce(
    (acc, file) => {
      const name = file
        .replace(/^src\//, '')
        .replace(/\.vendor-styles\.ts$/, '.vendor-styles.prebuilt');
      acc[name] = path.resolve(__dirname, file);
      return acc;
    },
    {} as Record<string, string>,
  );

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'src',
    emptyOutDir: false,
    rollupOptions: {
      input: entries,
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
    },
  },
});
