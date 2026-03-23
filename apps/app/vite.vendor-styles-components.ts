import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
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

// Move emitted font assets from src/assets/ to public/static/fonts/
// and rewrite URL references in prebuilt JS files
function moveAssetsToPublic(): Plugin {
  return {
    name: 'move-assets-to-public',
    closeBundle() {
      const srcDir = path.resolve(__dirname, 'src/assets');
      const destDir = path.resolve(__dirname, 'public/static/fonts');
      if (!fs.existsSync(srcDir)) return;

      // Move font files
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.renameSync(path.join(srcDir, file), path.join(destDir, file));
      }
      fs.rmdirSync(srcDir);

      // Rewrite /assets/ -> /static/fonts/ and prepend // @ts-nocheck in prebuilt JS files
      const prebuiltFiles = fs.globSync('src/**/*.vendor-styles.prebuilt.js', {
        cwd: __dirname,
      });
      for (const file of prebuiltFiles) {
        const filePath = path.resolve(__dirname, file);
        let content = fs.readFileSync(filePath, 'utf-8');
        if (content.includes('/assets/')) {
          content = content.replaceAll('/assets/', '/static/fonts/');
        }
        if (!content.startsWith('// @ts-nocheck')) {
          content = `// @ts-nocheck\n${content}`;
        }
        fs.writeFileSync(filePath, content);
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [moveAssetsToPublic()],
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
