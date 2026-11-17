/**
 * Integration test for the removal of the `keep` command's channel-permission
 * rows (the command is no longer offered, so no admin screen can show or edit
 * such a row).
 */
import type { Collection, Db } from 'mongodb';
import mongoose from 'mongoose';

describe('remove-keep-channel-permissions', () => {
  let db: Db;
  let collection: Collection;
  let migrate: typeof import('./20261116150000-remove-keep-channel-permissions');

  const commandNames = async () =>
    (await collection.find({}).toArray())
      .map((row) => `${row.relationId}:${row.commandName}`)
      .sort();

  beforeAll(async () => {
    migrate = await import('./20261116150000-remove-keep-channel-permissions');
    const connectedDb = mongoose.connection.db;
    if (connectedDb == null) {
      throw new Error('The test setup did not connect mongoose');
    }
    db = connectedDb;
    collection = db.collection('chat_channel_permissions');
  });

  beforeEach(async () => {
    await collection.deleteMany({});
    await collection.insertMany([
      { relationId: 'r1', commandName: 'keep', channelScope: 'all' },
      { relationId: 'r2', commandName: 'keep', channelScope: 'none' },
      { relationId: 'r1', commandName: 'create-page', channelScope: 'all' },
      {
        relationId: 'r1',
        commandName: 'agent',
        channelScope: 'none',
        allowedInDirectMessage: true,
      },
      { relationId: 'r2', commandName: 'search', channelScope: 'none' },
    ]);
  });

  afterAll(async () => {
    await collection.deleteMany({});
  });

  it('removes every keep row, whichever relation it belongs to', async () => {
    await migrate.up(db);

    expect(await collection.countDocuments({ commandName: 'keep' })).toBe(0);
  });

  it('leaves the rows of every other command exactly as they were', async () => {
    await migrate.up(db);

    expect(await commandNames()).toEqual([
      'r1:agent',
      'r1:create-page',
      'r2:search',
    ]);
    expect(await collection.findOne({ commandName: 'agent' })).toMatchObject({
      channelScope: 'none',
      allowedInDirectMessage: true,
    });
  });

  it('is a no-op when run a second time', async () => {
    await migrate.up(db);
    const afterFirst = await commandNames();

    await migrate.up(db);

    expect(await commandNames()).toEqual(afterFirst);
  });

  it('does nothing on a database that has no such collection', async () => {
    await collection.drop();

    await expect(migrate.up(db)).resolves.toBeUndefined();
  });

  it('rolls back without touching the remaining rows', async () => {
    await migrate.up(db);
    const afterUp = await commandNames();

    await migrate.down();

    expect(await commandNames()).toEqual(afterUp);
  });
});
