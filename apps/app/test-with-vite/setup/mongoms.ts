import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { mongoOptions } from '~/server/util/mongoose-utils';


beforeAll(async() => {
  // set debug flag
  process.env.MONGOMS_DEBUG = process.env.VITE_MONGOMS_DEBUG;

  // set version
  const mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: 'growi_test',
    },
    binary: {
      version: process.env.VITE_MONGOMS_VERSION,
      downloadDir: 'node_modules/.cache/mongodb-binaries',
    },
  });
  await mongoose.connect(mongoServer.getUri(), mongoOptions);
});

afterAll(async() => {
  await mongoose.disconnect();
});
