import { Types } from 'mongoose';

import type { ActivityDocument } from '~/server/models/activity';

import { decideEsSyncForEvent } from './decide-es-sync-for-event';
import { filterAdmittedUpserts } from './filter-admitted-upserts';

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn(() => 100) },
}));

// The gating decision itself (threshold math, multi-process race handling) is
// decide-es-sync-for-event.integ.ts's contract, not this file's — mocked here so
// filterAdmittedUpserts tests only exercise how its result is used.
vi.mock('./decide-es-sync-for-event', () => ({
  decideEsSyncForEvent: vi.fn(),
}));

type FixtureActivity = Pick<
  ActivityDocument,
  '_id' | 'snapshot' | 'endpoint' | 'createdAt'
>;

const makeActivity = (
  overrides: Partial<FixtureActivity> = {},
): FixtureActivity => ({
  _id: new Types.ObjectId(),
  snapshot: {},
  endpoint: '/_api/v3/login',
  createdAt: new Date(),
  ...overrides,
});

describe('filterAdmittedUpserts', () => {
  beforeEach(() => {
    vi.mocked(decideEsSyncForEvent).mockResolvedValue('admitted');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bypasses the gate for an authenticated log, even at a gated endpoint', async () => {
    const activity = makeActivity({ snapshot: { username: 'someone' } });

    const admitted = await filterAdmittedUpserts([activity]);

    expect(admitted).toEqual([activity]);
    expect(decideEsSyncForEvent).not.toHaveBeenCalled();
  });

  it('bypasses the gate for an anonymous log at an endpoint with no configured threshold', async () => {
    const activity = makeActivity({ endpoint: '/some-unlisted-path' });

    const admitted = await filterAdmittedUpserts([activity]);

    expect(admitted).toEqual([activity]);
    expect(decideEsSyncForEvent).not.toHaveBeenCalled();
  });

  it('excludes an anonymous log at a gated endpoint when decideEsSyncForEvent drops it', async () => {
    vi.mocked(decideEsSyncForEvent).mockResolvedValue('dropped');
    const activity = makeActivity();

    const admitted = await filterAdmittedUpserts([activity]);

    expect(admitted).toEqual([]);
  });

  it('includes an anonymous log at a gated endpoint when decideEsSyncForEvent admits it', async () => {
    const activity = makeActivity();

    const admitted = await filterAdmittedUpserts([activity]);

    expect(admitted).toEqual([activity]);
  });

  it("keys the gating window by the event's own createdAt, not the flush wall-clock time", async () => {
    // A backlog event from well outside the current minute (e.g. replayed after a
    // resume-token rewind) must be gated against ITS OWN window, not "now".
    const activity = makeActivity({
      createdAt: new Date('2020-01-01T00:00:30.000Z'),
    });

    await filterAdmittedUpserts([activity]);

    expect(decideEsSyncForEvent).toHaveBeenCalledWith(
      activity._id.toString(),
      '/_api/v3/login',
      new Date('2020-01-01T00:00:00.000Z'),
      expect.any(Number),
    );
  });

  it('matches the exact forgot-password endpoint, ignoring the query string', async () => {
    const activity = makeActivity({
      endpoint: '/_api/v3/forgot-password?revisionId=abc',
    });

    await filterAdmittedUpserts([activity]);

    expect(decideEsSyncForEvent).toHaveBeenCalledWith(
      activity._id.toString(),
      '/_api/v3/forgot-password',
      expect.any(Date),
      expect.any(Number),
    );
  });

  it('gates the installer endpoint (anonymous, no auth guard before addActivity)', async () => {
    const activity = makeActivity({ endpoint: '/_api/v3/installer' });

    await filterAdmittedUpserts([activity]);

    expect(decideEsSyncForEvent).toHaveBeenCalledWith(
      activity._id.toString(),
      '/_api/v3/installer',
      expect.any(Date),
      expect.any(Number),
    );
  });

  it('processes events sequentially, not concurrently, so admission decisions never race on the same counter', async () => {
    const callOrder: string[] = [];
    vi.mocked(decideEsSyncForEvent).mockImplementation(async (activityId) => {
      callOrder.push(`start:${activityId}`);
      await Promise.resolve();
      callOrder.push(`end:${activityId}`);
      return 'admitted';
    });
    const first = makeActivity();
    const second = makeActivity();

    await filterAdmittedUpserts([first, second]);

    // A concurrent (Promise.all) implementation would interleave as
    // [start:first, start:second, end:first, end:second] instead.
    expect(callOrder).toEqual([
      `start:${first._id.toString()}`,
      `end:${first._id.toString()}`,
      `start:${second._id.toString()}`,
      `end:${second._id.toString()}`,
    ]);
  });
});
