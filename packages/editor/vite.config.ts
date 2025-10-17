import path from 'node:path';
import react from '@vitejs/plugin-react';
import glob from 'glob';
import { nodeExternals } from 'rollup-plugin-node-externals';
import { Server } from 'socket.io';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { YSocketIO } from 'y-socket.io/dist/server';

const excludeFiles = [
  '**/components/playground/*',
  '**/main.tsx',
  '**/vite-env.d.ts',
];

const devSocketIOPlugin = (): Plugin => ({
  name: 'dev-socket-io',
  apply: 'serve',
  configureServer(server) {
    if (!server.httpServer) return;

    // setup socket.io
    const io = new Server(server.httpServer);
    io.on('connection', (socket) => {
      // eslint-disable-next-line no-console
      console.log('Client connected');

      socket.on('disconnect', () => {
        // eslint-disable-next-line no-console
        console.log('Client disconnected');
      });
    });

    // setup y-socket.io
    const ysocketio = new YSocketIO(io);
    ysocketio.initialize();
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    devSocketIOPlugin(),
    dts({
      entryRoot: 'src',
      exclude: [...excludeFiles],
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
