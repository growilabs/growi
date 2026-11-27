import { mock } from 'vitest-mock-extended';

import type { IPageWithSearchMeta } from '~/interfaces/search';

import {
  FACET_SEARCH_MAX_LIMIT,
  parseFacetPagination,
  parseFacetSearchParams,
  toFacetedSearchResult,
} from './facet-search-contract';

describe('parseFacetSearchParams', () => {
  it.each([
    [{}, null],
    [{ facet: 'pages' }, 'pages'],
    [{ facet: 'attachments' }, 'attachments'],
  ])('accepts %o as facet %s', (query, facet) => {
    expect(parseFacetSearchParams(query)).toEqual({ ok: true, facet });
  });

  it.each([
    { resolve: 'full' },
    { resolve: 'secret<b>' },
  ])('does not read resolve (%o)', (extra) => {
    expect(parseFacetSearchParams({ facet: 'attachments', ...extra })).toEqual({
      ok: true,
      facet: 'attachments',
    });
  });

  it.each<Record<string, unknown>>([
    { facet: 'all' },
    { facet: 'secret<b>' },
    { facet: '' },
    { facet: ['attachments', 'pages'] },
    { facet: { $ne: 'pages' } },
  ])('rejects %o with a fixed message', (query) => {
    expect(parseFacetSearchParams(query)).toEqual({
      ok: false,
      message: 'The param "facet" must be one of pages, attachments.',
    });
  });
});

describe('toFacetedSearchResult', () => {
  const primaryItem = (pageId: string): IPageWithSearchMeta => ({
    data: mock<IPageWithSearchMeta['data']>({ _id: pageId }),
    meta: { attachmentHits: [] },
  });

  it.each([
    false,
    true,
  ])('answers the given items with a null total and primaryResultIncomplete=%s', (primaryResultIncomplete) => {
    const items = [primaryItem('page-1-with-document')];

    expect(
      toFacetedSearchResult(
        { items: [primaryItem('page-1')], meta: { primaryResultIncomplete } },
        items,
      ),
    ).toEqual({
      data: items,
      meta: {
        facet: 'attachments',
        total: null,
        hitsCount: 1,
        primaryResultIncomplete,
      },
    });
  });

  it('counts hitsCount before the items whose page is gone were dropped', () => {
    const primary = {
      items: [
        primaryItem('page-1'),
        primaryItem('page-2'),
        primaryItem('page-3'),
      ],
      meta: { primaryResultIncomplete: false },
    };
    const remaining = [primaryItem('page-1')];

    const result = toFacetedSearchResult(primary, remaining);

    expect(result.data).toEqual(remaining);
    expect(result.meta.hitsCount).toBe(3);
  });
});

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
      message: `The param "limit" must be an integer between 1 and ${FACET_SEARCH_MAX_LIMIT} when "facet" is attachments.`,
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
        'The param "offset" must be a non-negative integer when "facet" is attachments.',
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
