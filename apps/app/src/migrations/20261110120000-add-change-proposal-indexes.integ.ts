import mongoose from 'mongoose';

const indexesByName = async (collectionName: string) => {
  const indexes = await mongoose.connection
    .collection(collectionName)
    .indexes();
  return new Map(indexes.map((index) => [index.name, index]));
};

describe('add-change-proposal-indexes', () => {
  let migrate: typeof import('./20261110120000-add-change-proposal-indexes');

  beforeAll(async () => {
    migrate = await import('./20261110120000-add-change-proposal-indexes');
  });

  it('gives changeproposals its six indexes, four of them sparse, and no TTL index', async () => {
    await migrate.up(mongoose.connection.db);

    const byName = await indexesByName('changeproposals');
    const denseNames = ['requester_1_createdAt_-1', 'lifecycle_1_expiresAt_1'];
    const sparseNames = [
      'applyLease.expiresAt_1',
      'lastAppliedAt_-1',
      'revertOf_1',
      'basedOn.proposalId_1',
    ];
    expect([...byName.keys()].filter((name) => name !== '_id_').sort()).toEqual(
      [...denseNames, ...sparseNames].sort(),
    );
    for (const name of denseNames) {
      expect(byName.get(name)?.sparse, name).not.toBe(true);
    }
    for (const name of sparseNames) {
      expect(byName.get(name)?.sparse, name).toBe(true);
    }
    expect(
      [...byName.values()].some((index) => index.expireAfterSeconds != null),
    ).toBe(false);
  });

  it('gives revisions a sparse index on proposalId and proposalOperationKey', async () => {
    await migrate.up(mongoose.connection.db);

    const index = (await indexesByName('revisions')).get(
      'proposalId_1_proposalOperationKey_1',
    );
    expect(index?.key).toEqual({ proposalId: 1, proposalOperationKey: 1 });
    expect(index?.sparse).toBe(true);
  });

  it('is a no-op when run again', async () => {
    await migrate.up(mongoose.connection.db);
    const before = await indexesByName('changeproposals');

    await migrate.up(mongoose.connection.db);

    expect(await indexesByName('changeproposals')).toEqual(before);
  });
});
