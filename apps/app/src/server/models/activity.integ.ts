import { Types } from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';

import Activity from './activity';

describe('Activity.findSnapshotUsernamesByUsernameRegex', () => {
  // Deleting only what this suite created (not deleteMany({})) avoids wiping
  // fixtures other integ files are relying on when CI runs them against a
  // single shared MongoDB instance.
  const createdIds: Types.ObjectId[] = [];

  afterEach(async () => {
    await Activity.deleteMany({ _id: { $in: createdIds } });
    createdIds.length = 0;
  });

  const createSnapshot = async (username: string) => {
    const activity = await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      // avoids collisions on the {user, target, action, createdAt} unique index
      target: new Types.ObjectId(),
      snapshot: { username },
    });
    createdIds.push(activity._id);
  };

  it('matches usernames by prefix', async () => {
    await createSnapshot('johnson');
    await createSnapshot('alice');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'john',
      { offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['johnson']);
  });

  it('does not match a mid-string occurrence', async () => {
    await createSnapshot('johnson');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'hnso',
      { offset: 0, limit: 10 },
    );

    expect(usernames).toEqual([]);
  });

  it('matches case-insensitively', async () => {
    await createSnapshot('johnson');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'JOHN',
      { offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['johnson']);
  });

  it('treats regex metacharacters in the query as literal characters', async () => {
    await createSnapshot('john.doe');
    await createSnapshot('johnXdoe');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'john.doe',
      { offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['john.doe']);
  });

  it('deduplicates snapshots that share the same username', async () => {
    await createSnapshot('johnson');
    await createSnapshot('johnson');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'john',
      { offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['johnson']);
  });
});

describe('Activity.findSnapshotUsernamesByUsernameRegexWithTotalCount', () => {
  // Deleting only what this suite created (not deleteMany({})) avoids wiping
  // fixtures other integ files are relying on when CI runs them against a
  // single shared MongoDB instance.
  const createdIds: Types.ObjectId[] = [];

  afterEach(async () => {
    await Activity.deleteMany({ _id: { $in: createdIds } });
    createdIds.length = 0;
  });

  const createSnapshot = async (username: string) => {
    const activity = await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      target: new Types.ObjectId(),
      snapshot: { username },
    });
    createdIds.push(activity._id);
  };

  it('returns matching usernames alongside a distinct total count', async () => {
    await createSnapshot('johnson');
    await createSnapshot('johnny');
    await createSnapshot('alice');

    const result =
      await Activity.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'john',
        { offset: 0, limit: 10 },
      );

    expect(result.totalCount).toBe(2);
    expect(result.usernames.sort()).toEqual(['johnny', 'johnson']);
  });

  it('counts all distinct matches even when the page is limited', async () => {
    await createSnapshot('johnson');
    await createSnapshot('johnny');

    const result =
      await Activity.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'john',
        { offset: 0, limit: 1 },
      );

    expect(result.usernames).toEqual(['johnny']);
    expect(result.totalCount).toBe(2);
  });

  it('returns an empty page and zero totalCount when nothing matches', async () => {
    await createSnapshot('alice');

    const result =
      await Activity.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'john',
        { offset: 0, limit: 10 },
      );

    expect(result.usernames).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
