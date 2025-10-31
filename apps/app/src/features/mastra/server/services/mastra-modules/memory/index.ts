import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';

// export const memory = new Memory({
//   storage: new MongoDBStore({
//     url: 'mongodb://mongo:27017',
//     dbName: 'growi',
//   }),
//   options: {
//     threads: {
//       generateTitle: true,
//     },
//     lastMessages: 30,
//   },
// });

export const storage = new MongoDBStore({
  url: 'mongodb://mongo:27017',
  dbName: 'growi',
});
