import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';

import { getMongoUri } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:mastra:memory');

const mongoUri = getMongoUri();

let dbName: string;
try {
  const parsed = new URL(mongoUri);
  dbName = parsed.pathname.substring(1);
  if (dbName === '') {
    throw new Error('MongoDB URI does not contain a database name');
  }
} catch (err) {
  logger.error('Failed to parse MongoDB URI', err);
  throw new Error('Invalid MongoDB URI');
}

export const memory = new Memory({
  storage: new MongoDBStore({
    id: 'growi-mastra-storage',
    url: mongoUri,
    dbName,
  }),
  options: {
    generateTitle: true,
    lastMessages: 30,
  },
});
