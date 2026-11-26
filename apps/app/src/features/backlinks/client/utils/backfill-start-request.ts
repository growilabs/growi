import {
  BackfillScopeKind,
  type BacklinksBackfillStartRequest,
} from '../../interfaces/page-link-backfill';

/** The scope picker's raw input. */
export interface BackfillScopeForm {
  readonly kind: BackfillScopeKind;
  readonly maxPages: string;
  /** `yyyy-MM-dd`, as a date input gives it. */
  readonly since: string;
}

export type BackfillStartRequestResult =
  | { readonly ok: true; readonly request: BacklinksBackfillStartRequest }
  | { readonly ok: false; readonly reason: 'invalidMaxPages' | 'invalidSince' };

const POSITIVE_INT = /^[1-9]\d*$/;
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight of a `yyyy-MM-dd` day; null for a malformed or impossible date. */
const startOfLocalDay = (value: string): Date | null => {
  const match = DATE_INPUT.exec(value);
  if (match == null) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  // Date rolls an impossible day (Feb 30) over into the next month.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

/**
 * The start request for the picked scope. A convenience before the server's own validation
 * (`backfill-scope-request.ts`), which stays the check.
 */
export const toBackfillStartRequest = (
  form: BackfillScopeForm,
  now: Date,
): BackfillStartRequestResult => {
  switch (form.kind) {
    case BackfillScopeKind.ALL:
      return { ok: true, request: { kind: BackfillScopeKind.ALL } };
    case BackfillScopeKind.MAX_PAGES: {
      const maxPages = Number(form.maxPages);
      return POSITIVE_INT.test(form.maxPages) && Number.isSafeInteger(maxPages)
        ? {
            ok: true,
            request: { kind: BackfillScopeKind.MAX_PAGES, maxPages },
          }
        : { ok: false, reason: 'invalidMaxPages' };
    }
    case BackfillScopeKind.SINCE: {
      const since = startOfLocalDay(form.since);
      return since != null && since.getTime() <= now.getTime()
        ? {
            ok: true,
            request: {
              kind: BackfillScopeKind.SINCE,
              since: since.toISOString(),
            },
          }
        : { ok: false, reason: 'invalidSince' };
    }
  }
};
