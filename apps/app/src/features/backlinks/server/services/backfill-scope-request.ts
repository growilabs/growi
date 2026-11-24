import { BackfillScopeKind } from '../../interfaces/page-link-backfill';
import type { BackfillScope } from '../models/page-link-backfill-job';

export type BackfillScopeParseResult =
  | { readonly ok: true; readonly scope: BackfillScope }
  | { readonly ok: false; readonly reason: string };

// `requestedScope.maxPages` is a Prisma `Int`, so a larger N could not be read back.
const MAX_PAGES_LIMIT = 2_147_483_647;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => Object.keys(value).every((key) => keys.includes(key));

const fail = (reason: string): BackfillScopeParseResult => ({
  ok: false,
  reason,
});

/**
 * Validate a start request's body. Types are checked, never coerced, so "5" is not a page count.
 *
 * @param now the moment `since` may not be after
 */
export const parseBackfillStartRequest = (
  body: unknown,
  now: Date,
): BackfillScopeParseResult => {
  if (!isPlainObject(body)) return fail('The body must be an object');

  switch (body.kind) {
    case BackfillScopeKind.ALL:
      if (!hasOnlyKeys(body, ['kind'])) {
        return fail('An "all" scope takes no other field');
      }
      return { ok: true, scope: { kind: BackfillScopeKind.ALL } };

    case BackfillScopeKind.MAX_PAGES: {
      const { maxPages } = body;
      if (!hasOnlyKeys(body, ['kind', 'maxPages'])) {
        return fail('A "maxPages" scope takes only maxPages');
      }
      if (
        typeof maxPages !== 'number' ||
        !Number.isSafeInteger(maxPages) ||
        maxPages < 1 ||
        maxPages > MAX_PAGES_LIMIT
      ) {
        return fail(`maxPages must be an integer from 1 to ${MAX_PAGES_LIMIT}`);
      }
      return {
        ok: true,
        scope: { kind: BackfillScopeKind.MAX_PAGES, maxPages },
      };
    }

    case BackfillScopeKind.SINCE: {
      const { since } = body;
      if (!hasOnlyKeys(body, ['kind', 'since'])) {
        return fail('A "since" scope takes only since');
      }
      if (typeof since !== 'string') return fail('since must be a date string');
      const date = new Date(since);
      if (Number.isNaN(date.getTime())) {
        return fail('since is not a valid date');
      }
      if (date.getTime() > now.getTime()) {
        return fail('since may not be in the future');
      }
      return {
        ok: true,
        scope: { kind: BackfillScopeKind.SINCE, since: date },
      };
    }

    default:
      return fail(
        `kind must be one of ${Object.values(BackfillScopeKind).join(', ')}`,
      );
  }
};
