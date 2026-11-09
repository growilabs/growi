import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.{test,spec,integ}.?(c|m)[jt]s?(x)'],
    fileParallelism: (process.env.BLACKBOX_URL ?? '') === '',
  },
});
