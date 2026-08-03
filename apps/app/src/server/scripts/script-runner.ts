import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '../util/mongoose-utils';

/**
 * Shared helpers for the standalone admin scripts (password-hash-cleanup,
 * password-hash-downgrade-prep, ...). These scripts run outside the normal server
 * boot, so each needs the same two things: a guard that only fires the CLI body
 * when the file is executed directly, and a connect/disconnect lifecycle around
 * the work.
 */

/**
 * True when this module's importer is the process entry point (invoked as
 * `node <script>` / `tsrun <script>`), not merely imported (e.g. by a test).
 *
 * Callers pass their own `import.meta.url`; comparing the caller's file against
 * `process.argv[1]` is what tells a direct run apart from an import.
 */
export const isEntryPoint = (importMetaUrl: string): boolean => {
  const entry = process.argv[1];
  return (
    entry != null && resolve(entry) === resolve(fileURLToPath(importMetaUrl))
  );
};

/**
 * Open a mongoose connection, run `fn`, and always disconnect afterwards (even
 * when `fn` throws). Keeps the connect/disconnect lifecycle identical across the
 * standalone scripts.
 */
export const withMongoConnection = async (
  fn: () => Promise<void>,
): Promise<void> => {
  await mongoose.connect(getMongoUri(), mongoOptions);
  try {
    await fn();
  } finally {
    await mongoose.disconnect();
  }
};
