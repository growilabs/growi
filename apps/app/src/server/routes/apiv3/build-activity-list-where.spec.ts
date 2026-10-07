/**
 * Unit tests for buildActivityListWhere pure function.
 *
 * Tests observable contract: given filter inputs, the function produces the
 * expected Prisma `where` object (or omits clauses when filters are absent).
 * No database access — this is a pure function.
 *
 * Requirements: 2.2 (filter conversion), design.md "apiv3/activity.ts" section.
 */

import { addMinutes } from 'date-fns/addMinutes';
import { parseISO } from 'date-fns/parseISO';

import { buildActivityListWhere } from './build-activity-list-where';

describe('buildActivityListWhere', () => {
  describe('username filter', () => {
    it('includes snapshot.is.username.in when usernames array is non-empty', () => {
      const where = buildActivityListWhere({
        usernames: ['alice', 'bob'],
        actions: undefined,
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).toMatchObject({
        snapshot: { is: { username: { in: ['alice', 'bob'] } } },
      });
    });

    it('omits snapshot clause when usernames is undefined', () => {
      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).not.toHaveProperty('snapshot');
    });

    it('omits snapshot clause when usernames is empty array', () => {
      const where = buildActivityListWhere({
        usernames: [],
        actions: undefined,
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).not.toHaveProperty('snapshot');
    });
  });

  describe('action filter', () => {
    it('includes action.in when searchableActions is non-empty', () => {
      const where = buildActivityListWhere({
        usernames: undefined,
        actions: ['PAGE_CREATE', 'PAGE_UPDATE'],
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).toMatchObject({
        action: { in: ['PAGE_CREATE', 'PAGE_UPDATE'] },
      });
    });

    it('omits action clause when actions is undefined (filter absent → all results)', () => {
      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).not.toHaveProperty('action');
    });

    // req 2.2 regression guard: the original Mongoose handler added the action
    // clause whenever `parsedSearchFilter.actions != null`, even when every
    // submitted action was filtered out by getAvailableActions (searchableActions
    // === []). Mongoose treated `{ action: [] }` as `{ action: { $in: [] } }`,
    // which returns ZERO results. Omitting the clause on empty would instead
    // return ALL results — an observable divergence (e.g. a bookmarked filter
    // URL whose action names are all now disabled must return zero rows).
    it('includes action.in:[] when actions is present but empty (all invalid → zero results)', () => {
      const where = buildActivityListWhere({
        usernames: undefined,
        actions: [],
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).toMatchObject({ action: { in: [] } });
    });

    it('distinguishes actions-absent from actions-present-but-empty (different where objects)', () => {
      const whereAbsent = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: undefined,
        endDate: undefined,
      });
      const whereEmpty = buildActivityListWhere({
        usernames: undefined,
        actions: [],
        startDate: undefined,
        endDate: undefined,
      });

      // absent → no clause (all results); empty → in:[] (zero results)
      expect(whereAbsent).not.toEqual(whereEmpty);
      expect(whereAbsent).not.toHaveProperty('action');
      expect(whereEmpty).toHaveProperty('action');
    });
  });

  describe('date range filter', () => {
    it('includes createdAt.gte/lt when both startDate and endDate are valid', () => {
      const start = parseISO('2025-01-01T00:00:00.000Z');
      const end = parseISO('2025-01-31T00:00:00.000Z');

      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: start,
        endDate: end,
      });

      expect(where).toMatchObject({
        createdAt: {
          gte: start,
          lt: addMinutes(end, 1439),
        },
      });
    });

    it('adds 1439 minutes to endDate for the lt bound when both dates provided', () => {
      const start = parseISO('2025-06-01T00:00:00.000Z');
      const end = parseISO('2025-06-01T00:00:00.000Z');
      const expectedLt = addMinutes(end, 1439);

      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: start,
        endDate: end,
      });

      expect(where.createdAt).toEqual({ gte: start, lt: expectedLt });
    });

    it('uses startDate for both bounds (+1439 min) when only startDate is valid', () => {
      const start = parseISO('2025-03-15T00:00:00.000Z');

      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: start,
        endDate: undefined,
      });

      expect(where).toMatchObject({
        createdAt: {
          gte: start,
          lt: addMinutes(start, 1439),
        },
      });
    });

    it('omits createdAt clause when both dates are invalid/undefined', () => {
      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).not.toHaveProperty('createdAt');
    });

    it('omits createdAt clause when only endDate is provided (no startDate)', () => {
      const end = parseISO('2025-01-31T00:00:00.000Z');

      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: undefined,
        endDate: end,
      });

      // Mirrors existing logic: only startDate-only branch exists, no endDate-only branch
      expect(where).not.toHaveProperty('createdAt');
    });
  });

  describe('combined filters', () => {
    it('combines all clauses when all filters are present', () => {
      const start = parseISO('2025-01-01T00:00:00.000Z');
      const end = parseISO('2025-01-31T00:00:00.000Z');

      const where = buildActivityListWhere({
        usernames: ['alice'],
        actions: ['PAGE_CREATE'],
        startDate: start,
        endDate: end,
      });

      expect(where).toMatchObject({
        snapshot: { is: { username: { in: ['alice'] } } },
        action: { in: ['PAGE_CREATE'] },
        createdAt: { gte: start, lt: addMinutes(end, 1439) },
      });
    });

    it('produces empty where object when no filters are present', () => {
      const where = buildActivityListWhere({
        usernames: undefined,
        actions: undefined,
        startDate: undefined,
        endDate: undefined,
      });

      expect(where).toEqual({});
    });
  });
});
