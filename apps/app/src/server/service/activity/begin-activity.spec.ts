// Import through the barrel on purpose: consumers (add-activity middleware,
// revertDeletedPage) use `beginActivity` via the activity barrel, and the
// barrel re-export is part of this module's contract. `./index` is explicit
// because the sibling file `service/activity.ts` shadows the directory for
// bare `~/server/service/activity` specifiers.
import { beginActivity, pendingActivityContext } from './index';
import type { PendingActivityContext } from './pending-activity-context';

const buildContext = (): PendingActivityContext => ({
  ip: '192.0.2.1',
  endpoint: '/_api/v3/pages/rename',
  userId: '507f1f77bcf86cd799439011',
  username: 'alice',
  createdAt: new Date('2026-07-08T00:00:00.000Z'),
});

describe('beginActivity', () => {
  it('returns an activityId usable as an Activity _id (24-hex ObjectId string)', () => {
    const { activityId } = beginActivity(buildContext());

    expect(activityId).toMatch(/^[0-9a-f]{24}$/);
  });

  it('stashes the passed context so take(activityId) returns it as-is (including createdAt)', () => {
    const context = buildContext();

    const { activityId } = beginActivity(context);
    const taken = pendingActivityContext.take(activityId);

    expect(taken).toEqual(context);
    expect(taken?.createdAt).toEqual(new Date('2026-07-08T00:00:00.000Z'));
  });

  it('mints a distinct id per call, each mapping to its own context', () => {
    const contextA = { ...buildContext(), username: 'alice' };
    const contextB = { ...buildContext(), username: 'bob' };

    const { activityId: idA } = beginActivity(contextA);
    const { activityId: idB } = beginActivity(contextB);

    expect(idA).not.toBe(idB);
    expect(pendingActivityContext.take(idA)?.username).toBe('alice');
    expect(pendingActivityContext.take(idB)?.username).toBe('bob');
  });
});
