import { parseBackfillStartRequest } from './backfill-scope-request';

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('parseBackfillStartRequest', () => {
  it.each([
    [{ kind: 'all' }, { kind: 'all' }],
    [
      { kind: 'maxPages', maxPages: 1 },
      { kind: 'maxPages', maxPages: 1 },
    ],
    [
      { kind: 'maxPages', maxPages: 2_147_483_647 },
      { kind: 'maxPages', maxPages: 2_147_483_647 },
    ],
    [
      { kind: 'since', since: '2026-01-01T00:00:00.000Z' },
      { kind: 'since', since: new Date('2026-01-01T00:00:00.000Z') },
    ],
    [
      { kind: 'since', since: NOW.toISOString() },
      { kind: 'since', since: NOW },
    ],
  ])('accepts %j', (body, scope) => {
    expect(parseBackfillStartRequest(body, NOW)).toEqual({ ok: true, scope });
  });

  it.each([
    ['a missing body', undefined],
    ['an array', [{ kind: 'all' }]],
    ['an unknown kind', { kind: 'newest' }],
    ['a missing kind', { maxPages: 5 }],
    ['a page count given as a string', { kind: 'maxPages', maxPages: '5' }],
    ['a zero page count', { kind: 'maxPages', maxPages: 0 }],
    ['a negative page count', { kind: 'maxPages', maxPages: -3 }],
    ['a fractional page count', { kind: 'maxPages', maxPages: 1.5 }],
    [
      'a page count past what is stored as an Int',
      { kind: 'maxPages', maxPages: 2_147_483_648 },
    ],
    ['a missing page count', { kind: 'maxPages' }],
    ['an unparseable date', { kind: 'since', since: 'last tuesday' }],
    ['a date given as a number', { kind: 'since', since: 1_700_000_000_000 }],
    [
      'a date in the future',
      { kind: 'since', since: new Date(NOW.getTime() + 1).toISOString() },
    ],
    ['a field of another kind', { kind: 'all', maxPages: 5 }],
    [
      'a date beside a page count',
      { kind: 'maxPages', maxPages: 5, since: '2026-01-01T00:00:00Z' },
    ],
  ])('refuses %s', (_label, body) => {
    expect(parseBackfillStartRequest(body, NOW)).toMatchObject({ ok: false });
  });
});
