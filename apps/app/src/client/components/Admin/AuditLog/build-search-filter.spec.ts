/**
 * Unit tests for buildActivitySearchFilter (pure function).
 *
 * Contract: given the selected/available actions plus dates and usernames,
 * produce the ISearchFilter the audit-log list request sends. The key behaviour
 * under test is the `actions` omission: when every available action is selected
 * the filter must NOT carry `actions` (server matches everything, request stays
 * small); a strict subset must carry exactly the selected actions.
 */

import type { SupportedActionType } from '~/interfaces/activity';

import { buildActivitySearchFilter } from './build-search-filter';

const AVAILABLE = [
  'PAGE_CREATE',
  'PAGE_UPDATE',
  'PAGE_DELETE',
] as SupportedActionType[];

const DATES = { startDate: '', endDate: '' };

describe('buildActivitySearchFilter', () => {
  describe('actions omission', () => {
    it('omits actions when every available action is selected', () => {
      const filter = buildActivitySearchFilter({
        selectedActions: [...AVAILABLE],
        availableActions: AVAILABLE,
        dates: DATES,
        usernames: [],
      });

      expect(filter).not.toHaveProperty('actions');
    });

    it('omits actions regardless of selection order', () => {
      const filter = buildActivitySearchFilter({
        selectedActions: ['PAGE_DELETE', 'PAGE_CREATE', 'PAGE_UPDATE'],
        availableActions: AVAILABLE,
        dates: DATES,
        usernames: [],
      });

      expect(filter).not.toHaveProperty('actions');
    });

    it('includes exactly the selected actions when a strict subset is selected', () => {
      const filter = buildActivitySearchFilter({
        selectedActions: ['PAGE_CREATE', 'PAGE_UPDATE'],
        availableActions: AVAILABLE,
        dates: DATES,
        usernames: [],
      });

      expect(filter.actions).toEqual(['PAGE_CREATE', 'PAGE_UPDATE']);
    });

    it('includes actions:[] when nothing is selected (→ server returns zero rows)', () => {
      // Unchecking every action must stay observable as "zero results", not
      // collapse into the all-selected "match everything" case.
      const filter = buildActivitySearchFilter({
        selectedActions: [],
        availableActions: AVAILABLE,
        dates: DATES,
        usernames: [],
      });

      expect(filter.actions).toEqual([]);
    });

    it('does not treat an empty available list as all-selected', () => {
      // Guard against `0 === 0` false positives: with no available actions there
      // is nothing to match, so `actions` must still be sent (as []).
      const filter = buildActivitySearchFilter({
        selectedActions: [],
        availableActions: [],
        dates: DATES,
        usernames: [],
      });

      expect(filter.actions).toEqual([]);
    });
  });

  describe('dates and usernames passthrough', () => {
    it('always carries the provided dates and usernames', () => {
      const dates = { startDate: '2025-01-01', endDate: '2025-01-31' };
      const filter = buildActivitySearchFilter({
        selectedActions: [...AVAILABLE],
        availableActions: AVAILABLE,
        dates,
        usernames: ['alice', 'bob'],
      });

      expect(filter).toMatchObject({
        dates,
        usernames: ['alice', 'bob'],
      });
    });
  });
});
