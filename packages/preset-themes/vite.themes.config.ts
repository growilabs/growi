import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    build: {
      outDir: 'dist/themes',
      manifest: true,
      rollupOptions: {
        input: [
          '/src/styles/antarctic.scss',
          '/src/styles/blackboard.scss',
          '/src/styles/christmas.scss',
          '/src/styles/default.scss',
          '/src/styles/fire-red.scss',
          '/src/styles/future.scss',
          '/src/styles/halloween.scss',
          '/src/styles/hufflepuff.scss',
          '/src/styles/kibela.scss',
          '/src/styles/island.scss',
          '/src/styles/jade-green.scss',
          '/src/styles/mono-blue.scss',
          '/src/styles/nature.scss',
          '/src/styles/spring.scss',
          '/src/styles/wood.scss',
          '/src/styles/classic.scss',
        ],
        output: {
          assetFileNames: isProd ? undefined : 'assets/[name].[ext]', // not attach hash
        },
      },
    },
  };
});
