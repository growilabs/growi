import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.spec.ts',
      'src/**/*.integ.ts',
      // docker-entrypoint.ts lives outside src/ so it is excluded from the
      // compiled dist/ artifact (it is run via Node type stripping in the image).
      'docker/**/*.spec.ts',
    ],
    // Boot one in-process vault-manager per worker for integration tests.
    // No-op for the unit suite (guarded by RUN_VAULT_INTEG inside the file).
    setupFiles: ['./src/__tests__/setup/integ-server.ts'],
    // 'forks' (the default) gives each worker its own process, so the server's
    // module-level singletons (repo path, scheduler, mongoose connection) and
    // the per-worker PORT are isolated per worker.
    pool: 'forks',
  },
});
