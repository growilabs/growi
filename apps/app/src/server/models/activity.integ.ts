import { Types } from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';

import Activity from './activity';

describe('Activity.findSnapshotUsernamesByUsernameRegex', () => {
  afterEach(async () => {
    await Activity.deleteMany({});
  });

  const createSnapshot = async (username: string) => {
    await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      // avoids collisions on the {user, target, action, createdAt} unique index
      target: new Types.ObjectId(),
      snapshot: { username },
    });
  };

  it('matches usernames by prefix', async () => {
    await createSnapshot('johnson');
    await createSnapshot('alice');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'john',
      { sortOpt: 1, offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['johnson']);
  });

  it('does not match a mid-string occurrence', async () => {
    await createSnapshot('johnson');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'hnso',
      { sortOpt: 1, offset: 0, limit: 10 },
    );

    expect(usernames).toEqual([]);
  });

  it('matches case-insensitively', async () => {
    await createSnapshot('johnson');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'JOHN',
      { sortOpt: 1, offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['johnson']);
  });

  it('treats regex metacharacters in the query as literal characters', async () => {
    await createSnapshot('john.doe');
    await createSnapshot('johnXdoe');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'john.doe',
      { sortOpt: 1, offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['john.doe']);
  });

  it('deduplicates snapshots that share the same username', async () => {
    await createSnapshot('johnson');
    await createSnapshot('johnson');

    const usernames = await Activity.findSnapshotUsernamesByUsernameRegex(
      'john',
      { sortOpt: 1, offset: 0, limit: 10 },
    );

    expect(usernames).toEqual(['johnson']);
  });
});

describe('Activity.findSnapshotUsernamesByUsernameRegexWithTotalCount', () => {
  afterEach(async () => {
    await Activity.deleteMany({});
  });

  it('returns matching usernames alongside a distinct total count', async () => {
    await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      target: new Types.ObjectId(),
      snapshot: { username: 'johnson' },
    });
    await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      target: new Types.ObjectId(),
      snapshot: { username: 'johnny' },
    });
    await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      target: new Types.ObjectId(),
      snapshot: { username: 'alice' },
    });

    const result =
      await Activity.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'john',
        { offset: 0, limit: 10 },
      );

    expect(result.totalCount).toBe(2);
    expect(result.usernames.sort()).toEqual(['johnny', 'johnson']);
  });
});
