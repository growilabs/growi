import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import Contribution from '../models/contribution-model';
import { addContribution } from './contribution-service';

describe('addContribution', () => {
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

  it('should create a new contribution record if it does not exist (upsert)', async () => {
    await addContribution(userId);

    const contribution = await Contribution.findOne({ user: userId });
    expect(contribution).toBeDefined();
    expect(contribution?.count).toBe(1);
    expect(contribution?.date.getHours()).toBe(0);
  });

  it('should increment the count for an existing record on the same day', async () => {
    // 1. Create initial record
    await addContribution(userId);
    // 2. Increment it
    await addContribution(userId);

    const doc = await Contribution.findOne({ user: userId });
    expect(doc?.count).toBe(2);
  });

  it('should throw an error if the userId is invalid', async () => {
    await expect(addContribution('invalid-id')).rejects.toThrow(
      'User ID is invalid',
    );
  });

  it('should create a separate record for a different day', async () => {
    // Create a record for "yesterday" manually
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    await Contribution.create({ user: userId, date: yesterday, count: 1 });

    // Run the function (which uses "today")
    await addContribution(userId);

    // Verify we now have two separate documents
    const contributions = await Contribution.countDocuments({ user: userId });
    expect(contributions).toBe(2);
  });
});
