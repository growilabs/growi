import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';

import { getMongoUri } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:mastra:memory');

let dbName: string;
let url: string;
try {
  const mongoUrl = new URL(getMongoUri());
  dbName = mongoUrl.pathname.substring(1);
  url = `${mongoUrl.protocol}//${mongoUrl.host}`;
} catch (err) {
  logger.error('Failed to parse MongoDB URI', err);
  throw new Error(`Invalid MongoDB URI`);
}

export const memory = new Memory({
  storage: new MongoDBStore({
    id: 'growi-mastra-storage',
    url,
    dbName,
  }),
  options: {
    generateTitle: true,
    lastMessages: 30,
  },
});
