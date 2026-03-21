import { resolve } from 'node:path';
import { config } from 'dotenv-flow';
import { MongoClient } from 'mongodb';
import { MongoDBStorage, Umzug } from 'umzug';

import { PrismaClient } from '~/generated/prisma/client';

config();

(async () => {
  const url = process.env.MONGO_URI;
  if (url === undefined) {
    throw new Error('MONGO_URI is required');
  }
  const client = new MongoClient(url);
  await client.connect();

  const prisma = new PrismaClient();

  const umzug = new Umzug({
    migrations: { glob: resolve(__dirname, 'migrations/*.(ts|js)') },
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

export type Migration = (args: { context: PrismaClient }) => Promise<void>;
