import type { Collection, Db } from 'mongodb';
import mongoose from 'mongoose';

const INDEX_NAME = 'endpoint_1';

describe('add-endpoint-index-to-activities', () => {
  let db: Db;
  let activities: Collection;
  let migrate: typeof import('./20261111120000-add-endpoint-index-to-activities');

  beforeAll(async () => {
    migrate = await import('./20261111120000-add-endpoint-index-to-activities');
    db = mongoose.connection.db as unknown as Db;
    activities = db.collection('activities');
  });

  beforeEach(async () => {
    await activities.dropIndex(INDEX_NAME).catch(() => {});
  });

  // The shared test DB is migrated up front; leave the index as found.
  afterAll(async () => {
    await migrate.up(db);
  });

  it('creates the endpoint index under the name schema.prisma maps', async () => {
    await migrate.up(db);

    const index = (await activities.indexes()).find(
      (i) => i.name === INDEX_NAME,
    );
    expect(index?.key).toEqual({ endpoint: 1 });
  });

  it('is a no-op when the index already exists', async () => {
    await migrate.up(db);

    await migrate.up(db);

    expect(await activities.indexExists(INDEX_NAME)).toBe(true);
  });

  it('drops the index on down()', async () => {
    await migrate.up(db);

    await migrate.down(db);

    expect(await activities.indexExists(INDEX_NAME)).toBe(false);
  });
});
