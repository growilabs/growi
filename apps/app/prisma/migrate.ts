/**
 * umzug cli
 *
 * Usage:
 *   pnpm ts-node prisma/migrate.ts
 */
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { MongoDBStorage, Umzug } from 'umzug';

import { prisma } from '~/utils/prisma';

(async () => {
  const url = process.env.MONGO_URI;
  if (url === undefined) {
    throw new Error('MONGO_URI is required');
  }
  const client = new MongoClient(url);
  await client.connect();

  const umzug = new Umzug({
    migrations: { glob: resolve(__dirname, '../prisma/migrations/*.(ts|js)') },
    context: prisma,
    storage: new MongoDBStorage({
      connection: client.db(),
    }),
    logger: console,
  });

  if (require.main === module) {
    await umzug.runAsCLI();
    process.exit(0);
  }
})();
