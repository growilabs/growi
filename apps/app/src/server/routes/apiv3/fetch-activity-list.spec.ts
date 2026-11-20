/**
 * Unit tests for resolveActivityListWhere (pure function).
 *
 * Contract: given the actions available under the current audit-log config and
 * a parsed search filter, produce the Prisma `where` object — intersecting the
 * submitted actions with the available ones and parsing the date range. No DB
 * access.
 *
 * The action-intersection and date-parsing logic used to live inline in the GET
 * route handler; extracting it here lets both the GET and the new POST route
 * share one implementation, and makes the intersection behaviour testable.
 */

import { addMinutes } from 'date-fns/addMinutes';
import { parseISO } from 'date-fns/parseISO';

import { resolveActivityListWhere } from './fetch-activity-list';

const AVAILABLE = ['PAGE_CREATE', 'PAGE_UPDATE', 'PAGE_DELETE'] as const;

describe('resolveActivityListWhere', () => {
  describe('action intersection', () => {
    it('omits the action clause when actions is absent (→ all results)', () => {
      const where = resolveActivityListWhere(AVAILABLE, {});

      expect(where).not.toHaveProperty('action');
    });

    it('keeps every action when all submitted actions are available', () => {
      const where = resolveActivityListWhere(AVAILABLE, {
        actions: ['PAGE_CREATE', 'PAGE_UPDATE'],
      });

      expect(where).toMatchObject({
        action: { in: ['PAGE_CREATE', 'PAGE_UPDATE'] },
      });
    });

    it('drops submitted actions that are not currently available', () => {
      const where = resolveActivityListWhere(AVAILABLE, {
        // PAGE_CREATE is available; ADMIN_APP_SETTING_UPDATE is not
        actions: ['PAGE_CREATE', 'ADMIN_APP_SETTING_UPDATE'],
      });

      expect(where).toMatchObject({ action: { in: ['PAGE_CREATE'] } });
    });

    it('emits action.in:[] when every submitted action is unavailable (→ zero results)', () => {
      const where = resolveActivityListWhere(AVAILABLE, {
        actions: ['ADMIN_APP_SETTING_UPDATE'],
      });

      // present-but-all-invalid must be distinguishable from absent: in:[] means
      // zero results, matching the original Mongoose { action: { $in: [] } }.
      expect(where).toMatchObject({ action: { in: [] } });
    });
  });

  describe('date range parsing', () => {
    it('builds a createdAt clause from a valid ISO start/end range', () => {
      const startDate = '2025-01-01T00:00:00.000Z';
      const endDate = '2025-01-31T00:00:00.000Z';

      const where = resolveActivityListWhere(AVAILABLE, {
        dates: { startDate, endDate },
      });

      expect(where).toMatchObject({
        createdAt: {
          gte: parseISO(startDate),
          lt: addMinutes(parseISO(endDate), 1439),
        },
      });
    });

    it('omits the createdAt clause when the dates are empty strings', () => {
      const where = resolveActivityListWhere(AVAILABLE, {
        dates: { startDate: '', endDate: '' },
      });

      expect(where).not.toHaveProperty('createdAt');
    });

    it('omits the createdAt clause when dates is absent', () => {
      const where = resolveActivityListWhere(AVAILABLE, {});

      expect(where).not.toHaveProperty('createdAt');
    });
  });

  describe('usernames', () => {
    it('passes usernames through to the snapshot composite filter', () => {
      const where = resolveActivityListWhere(AVAILABLE, {
        usernames: ['alice'],
      });

      expect(where).toMatchObject({
        snapshot: { is: { username: { in: ['alice'] } } },
      });
    });
  });
});
