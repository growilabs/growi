import {
  type BackfillScopeForm,
  toBackfillStartRequest,
} from './backfill-start-request';

const NOW = new Date(2026, 2, 10, 15, 0, 0);

const formOf = (overrides: Partial<BackfillScopeForm>): BackfillScopeForm => ({
  kind: 'all',
  maxPages: '',
  since: '',
  ...overrides,
});

describe('toBackfillStartRequest', () => {
  it('builds an all-pages request', () => {
    expect(toBackfillStartRequest(formOf({ kind: 'all' }), NOW)).toEqual({
      ok: true,
      request: { kind: 'all' },
    });
  });

  it('builds a newest-N request from a positive whole number', () => {
    expect(
      toBackfillStartRequest(
        formOf({ kind: 'maxPages', maxPages: '500' }),
        NOW,
      ),
    ).toEqual({ ok: true, request: { kind: 'maxPages', maxPages: 500 } });
  });

  it.each([
    '',
    '0',
    '-3',
    '1.5',
    'abc',
    '1e3',
  ])('refuses a newest-N value of %j', (maxPages) => {
    expect(
      toBackfillStartRequest(formOf({ kind: 'maxPages', maxPages }), NOW),
    ).toEqual({ ok: false, reason: 'invalidMaxPages' });
  });

  // A date input names a local calendar day; its start is local midnight.
  it('builds a since request from the start of the chosen local day', () => {
    expect(
      toBackfillStartRequest(
        formOf({ kind: 'since', since: '2026-03-01' }),
        NOW,
      ),
    ).toEqual({
      ok: true,
      request: {
        kind: 'since',
        since: new Date(2026, 2, 1).toISOString(),
      },
    });
  });

  it('accepts today', () => {
    expect(
      toBackfillStartRequest(
        formOf({ kind: 'since', since: '2026-03-10' }),
        NOW,
      ).ok,
    ).toBe(true);
  });

  it.each([
    '',
    '2026-03-11',
    'not-a-date',
    '2026-02-30',
  ])('refuses a since value of %j', (since) => {
    expect(
      toBackfillStartRequest(formOf({ kind: 'since', since }), NOW),
    ).toEqual({ ok: false, reason: 'invalidSince' });
  });
});
