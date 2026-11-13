import {
  FACET_SEARCH_MAX_LIMIT,
  parseFacetPagination,
} from './facet-search-contract';

describe('parseFacetPagination', () => {
  it.each([
    [{}, { from: 0, size: 50 }],
    [
      { limit: '', offset: '' },
      { from: 0, size: 50 },
    ],
    [
      { limit: '1', offset: '0' },
      { from: 0, size: 1 },
    ],
    [{ limit: String(FACET_SEARCH_MAX_LIMIT) }, { from: 0, size: 200 }],
    [
      { limit: '20', offset: '40' },
      { from: 40, size: 20 },
    ],
  ])('accepts %o', (query, expected) => {
    expect(parseFacetPagination(query)).toEqual({ ok: true, ...expected });
  });

  it.each([
    '0',
    '-5',
    '1.5',
    'NaN',
    'abc',
    '1e9',
    '1000000000',
    String(FACET_SEARCH_MAX_LIMIT + 1),
    ' 10',
    '0x10',
  ])('rejects limit=%s with a fixed message', (limit) => {
    const result = parseFacetPagination({ limit });

    expect(result).toEqual({
      ok: false,
      message: `The param "limit" must be an integer between 1 and ${FACET_SEARCH_MAX_LIMIT} when "facet" is all or attachments.`,
    });
  });

  it.each([
    '-1',
    'NaN',
    'abc',
    '1.5',
    '1e3',
    '99999999999999999999',
  ])('rejects offset=%s with a fixed message', (offset) => {
    const result = parseFacetPagination({ limit: '10', offset });

    expect(result).toEqual({
      ok: false,
      message:
        'The param "offset" must be a non-negative integer when "facet" is all or attachments.',
    });
  });

  it.each([
    { limit: ['10', '20'] },
    { limit: { $gt: '0' } },
    { offset: ['0'] },
  ])('rejects a non-string value %o', (query) => {
    expect(parseFacetPagination(query)).toMatchObject({ ok: false });
  });
});
