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
      // biome-ignore lint/suspicious/noConsole: Allow to use
      console.log('Client connected');

      socket.on('disconnect', () => {
        // biome-ignore lint/suspicious/noConsole: Allow to use
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
