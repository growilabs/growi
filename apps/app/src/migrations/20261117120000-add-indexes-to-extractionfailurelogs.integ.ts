import mongoose from 'mongoose';

const COLLECTION = 'extractionfailurelogs';

const indexesByName = async () => {
  const indexes = await mongoose.connection.collection(COLLECTION).indexes();
  return new Map(indexes.map((index) => [index.name, index]));
};

describe('add-indexes-to-extractionfailurelogs', () => {
  let migrate: typeof import('./20261117120000-add-indexes-to-extractionfailurelogs');

  beforeAll(async () => {
    migrate = await import(
      './20261117120000-add-indexes-to-extractionfailurelogs'
    );
  });

  beforeEach(async () => {
    // The template database has already run every migration
    await mongoose.connection.db?.dropCollection(COLLECTION).catch(() => {});
  });

  it('expires entries 90 days after occurredAt and indexes the lookup fields', async () => {
    await migrate.up(mongoose.connection.db);

    const byName = await indexesByName();
    expect([...byName.keys()].filter((name) => name !== '_id_').sort()).toEqual(
      ['attachmentId_1', 'occurredAt_1', 'retentionGroupHash_1'],
    );
    expect(byName.get('occurredAt_1')).toMatchObject({
      key: { occurredAt: 1 },
      expireAfterSeconds: 60 * 60 * 24 * 90,
    });
    expect(byName.get('attachmentId_1')?.key).toEqual({ attachmentId: 1 });
    expect(byName.get('retentionGroupHash_1')?.key).toEqual({
      retentionGroupHash: 1,
    });
  });

  it('is a no-op when run again', async () => {
    await migrate.up(mongoose.connection.db);
    const before = await indexesByName();

    await migrate.up(mongoose.connection.db);

    expect(await indexesByName()).toEqual(before);
  });
});
