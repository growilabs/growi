import path from 'node:path';
import { YJS_WEBSOCKET_BASE_PATH } from '@growi/core/dist/consts';
import react from '@vitejs/plugin-react';
import glob from 'glob';
import { nodeExternals } from 'rollup-plugin-node-externals';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const YJS_PATH_PREFIX = `${YJS_WEBSOCKET_BASE_PATH}/`;

const excludeFiles = [
  '**/components/playground/*',
  '**/main.tsx',
  '**/vite-env.d.ts',
];

const devWebSocketPlugin = (): Plugin => ({
  name: 'dev-y-websocket',
  apply: 'serve',
  configureServer(server) {
    if (!server.httpServer) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setupWSConnection } = require('y-websocket/bin/utils');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebSocketServer } = require('ws');

    const wss = new WebSocketServer({ noServer: true });

    server.httpServer.on('upgrade', (request, socket, head) => {
      const url = request.url ?? '';
      if (!url.startsWith(YJS_PATH_PREFIX)) return;

      const pageId = url.slice(YJS_PATH_PREFIX.length).split('?')[0];

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
        setupWSConnection(ws, request, { docName: pageId });
      });
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    devWebSocketPlugin(),
    dts({
      entryRoot: 'src',
      exclude: [...excludeFiles],
      copyDtsFiles: true,
      // Fix TS2345/TS2719 "Two different types with this name exist" errors
      // during declaration file generation.
      //
      // vite-plugin-dts internally creates its own TypeScript program, which
      // resolves @codemirror/state and @codemirror/view through different pnpm
      // symlink chains depending on whether the import originates from
      // @growi/editor source or from @uiw/react-codemirror's re-exports.
      // Although both chains point to the same physical package, TypeScript
      // treats them as distinct types because private fields (e.g.
      // SelectionRange#flags) create nominal type identity per declaration.
      //
      // Pinning paths here forces vite-plugin-dts to resolve these packages
      // to a single location regardless of the import origin.
      compilerOptions: {
        paths: {
          '@codemirror/state': [
            path.resolve(__dirname, 'node_modules/@codemirror/state'),
          ],
          '@codemirror/view': [
            path.resolve(__dirname, 'node_modules/@codemirror/view'),
          ],
        },
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
      entry: glob.sync(path.resolve(__dirname, 'src/**/*.{ts,tsx}'), {
        ignore: [...excludeFiles, '**/*.spec.ts'],
      }),
      name: 'editor-libs',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
      },
    },
  },
});
