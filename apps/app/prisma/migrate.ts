/**
 * umzug cli
 *
 * Usage:
 *   node --import tsx --import dotenv-flow/config prisma/migrate.ts
 *   (or via the dev:umzug / migrate:umzug scripts)
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoDBStorage, Umzug } from 'umzug';

(async () => {
  const url = process.env.MONGO_URI;
  if (url === undefined) {
    throw new Error('MONGO_URI is required');
  }
  const { prisma } = await import(
    process.env.NODE_ENV === 'production'
      ? '../dist/utils/prisma'
      : '../src/utils/prisma'
  );
  const client = new MongoClient(url);
  await client.connect();

  const umzug = new Umzug({
    migrations: {
      glob: resolve(import.meta.dirname, '../prisma/migrations/*.(ts|js)'),
    },
    context: prisma,
    storage: new MongoDBStorage({
      connection: client.db(),
    }),
    logger: console,
  });

  // ESM entry-point check (replaces the CJS `require.main === module`):
  // under tsx + `"type": "module"` neither `require` nor `module` exists.
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    await umzug.runAsCLI();
    process.exit(0);
  }
})();
