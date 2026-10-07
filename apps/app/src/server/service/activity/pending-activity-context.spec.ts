// Import through the barrel on purpose: per the design, consumers
// (ActivityService listener, beginActivity) access the map as
// `pendingActivityContext.*` via the activity barrel. `./index` is explicit
// because the sibling file `service/activity.ts` shadows the directory for
// bare `~/server/service/activity` specifiers.
import { pendingActivityContext } from './index';
import type { PendingActivityContext } from './pending-activity-context';

const buildContext = (): PendingActivityContext => ({
  ip: '192.0.2.1',
  endpoint: '/_api/v3/pages/rename',
  userId: '507f1f77bcf86cd799439011',
  username: 'alice',
  createdAt: new Date('2026-07-08T00:00:00.000Z'),
});

describe('pendingActivityContext', () => {
  describe('set → take', () => {
    it('returns the stashed context including createdAt', () => {
      const context = buildContext();

      pendingActivityContext.set('id-set-take', context);
      const taken = pendingActivityContext.take('id-set-take');

      expect(taken).toEqual(context);
      expect(taken?.createdAt).toEqual(new Date('2026-07-08T00:00:00.000Z'));
    });

    it('empties the entry synchronously (get + delete): a second take in the same tick returns undefined', () => {
      pendingActivityContext.set('id-double-take', buildContext());

      // No await between the two calls: proves get + delete happen
      // synchronously within a single take() call
      const first = pendingActivityContext.take('id-double-take');
      const second = pendingActivityContext.take('id-double-take');

      expect(first).toBeDefined();
      expect(second).toBeUndefined();
    });
  });

  describe('take', () => {
    it('returns undefined for an id that was never set', () => {
      expect(pendingActivityContext.take('id-never-set')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('removes an existing entry so a later take returns undefined', () => {
      pendingActivityContext.set('id-clear', buildContext());

      pendingActivityContext.clear('id-clear');

      expect(pendingActivityContext.take('id-clear')).toBeUndefined();
    });

    it('is idempotent: clearing a missing id or clearing twice does not throw', () => {
      expect(() => pendingActivityContext.clear('id-missing')).not.toThrow();

      pendingActivityContext.set('id-clear-twice', buildContext());
      pendingActivityContext.clear('id-clear-twice');

      expect(() =>
        pendingActivityContext.clear('id-clear-twice'),
      ).not.toThrow();
      expect(pendingActivityContext.take('id-clear-twice')).toBeUndefined();
    });
  });
});
