import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';

const storage = new MongoDBStore({
  url: 'mongodb://mongo:27017',
  dbName: 'growi',
});

export const memory = new Memory({
  storage,
  options: {
    threads: {
      generateTitle: true,
    },
    lastMessages: 30,
  },
});
