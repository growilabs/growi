import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';

import { getMongoUri } from '~/server/util/mongoose-utils';

const mongodbUri = getMongoUri();

// https://regex101.com/r/7skgng/1
const regex = /^(mongodb:\/\/[^@/]+:\d+)\/(\w+)$/;
const match = mongodbUri.match(regex);
const url = match?.[1];
const dbName = match?.[2];

if (url == null || dbName == null) {
  throw new Error('Invalid MongoDB URI');
}

export const memory = new Memory({
  storage: new MongoDBStore({ url, dbName }),
  options: {
    threads: {
      generateTitle: true,
    },
    lastMessages: 30,
  },
});
