import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import Contribution from '../models/contribution-model';

describe('migrateContributions', () => {
  const userId = new mongoose.Types.ObjectId().toString();

  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
  });

  beforeEach(async () => {
    await Contribution.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  it('', async () => {});
});
