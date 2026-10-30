/**
 * Integration test for the activities.endpoint access_token redaction
 * migration. Rows are inserted via the raw driver so they keep the raw token,
 * as rows saved before the model redacted on save did.
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

describe('redact-access-token-from-activity-endpoints', () => {
  let collection: Collection;
  let migrate: typeof import('./20261030120000-redact-access-token-from-activity-endpoints');
  const createdIds: ObjectId[] = [];

  const insertActivity = async (endpoint: string): Promise<ObjectId> => {
    const id = new ObjectId();
    await collection.insertOne({
      _id: id,
      __v: 0,
      action: 'PAGE_CREATE',
      createdAt: new Date(),
      endpoint,
      ip: '10.0.0.94',
      snapshot: { _id: new ObjectId() },
    });
    createdIds.push(id);
    return id;
  };

  const endpointOf = async (id: ObjectId) =>
    (await collection.findOne({ _id: id }))?.endpoint;

  beforeAll(async () => {
    migrate = await import(
      './20261030120000-redact-access-token-from-activity-endpoints'
    );
    collection = mongoose.connection.collection('activities');
  });

  afterEach(async () => {
    await collection.deleteMany({ _id: { $in: createdIds } });
    createdIds.length = 0;
  });

  it('redacts a raw access_token, including a percent-encoded key', async () => {
    const plain = await insertActivity('/_search?q=foo&access_token=secret');
    const encoded = await insertActivity('/_api/v3/pages?access%5Ftoken=secret');

    await migrate.up();

    expect(await endpointOf(plain)).toBe('/_search?q=foo&access_token=[REDACTED]');
    expect(await endpointOf(encoded)).toBe(
      '/_api/v3/pages?access%5Ftoken=[REDACTED]',
    );
  });

  it('leaves endpoints without an access_token untouched', async () => {
    const noQuery = await insertActivity('/_api/v3/pages');
    const otherQuery = await insertActivity('/_api/v3/pages?limit=10');

    await migrate.up();

    expect(await endpointOf(noQuery)).toBe('/_api/v3/pages');
    expect(await endpointOf(otherQuery)).toBe('/_api/v3/pages?limit=10');
  });

  it('fails instead of completing when a batch reports write errors', async () => {
    await insertActivity('/_search?access_token=secret');
    await mongoose.connection.db?.command({
      collMod: 'activities',
      validator: { endpoint: { $not: /REDACTED/ } },
    });

    try {
      await expect(migrate.up()).rejects.toThrow(
        'Failed to redact access_token from activities.endpoint',
      );
    } finally {
      await mongoose.connection.db?.command({
        collMod: 'activities',
        validator: {},
      });
    }
  });

  it('is a no-op when re-run', async () => {
    const id = await insertActivity('/_search?access_token=secret');

    await migrate.up();
    await migrate.up();

    expect(await endpointOf(id)).toBe('/_search?access_token=[REDACTED]');
  });
});
