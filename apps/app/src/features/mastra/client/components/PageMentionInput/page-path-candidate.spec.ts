import type { IPageHasId, IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type { IPageWithSearchMeta } from '~/interfaces/search';

import { toPagePathCandidate } from './page-path-candidate';

describe('toPagePathCandidate', () => {
  // `mock<T>` auto-stubs every unset property (including the optional `creator`)
  // as a truthy stub, so optional fields the projection branches on must be set
  // explicitly — default `creator` to undefined and let callers override it.
  const buildData = (overrides: Partial<IPageHasId>): IPageHasId =>
    mock<IPageHasId>({ creator: undefined, ...overrides });

  const buildSearchMeta = (id: string, path: string): IPageWithSearchMeta => ({
    data: buildData({ _id: id, path }),
    meta: {},
  });

  it('projects data._id and data.path into pageId and path', () => {
    const result = toPagePathCandidate(
      buildSearchMeta('6650f0000000000000000001', '/foo/bar'),
    );

    expect(result).toEqual({
      pageId: '6650f0000000000000000001',
      path: '/foo/bar',
      creator: null,
    });
  });

  it('preserves the path verbatim including nested segments', () => {
    const result = toPagePathCandidate(
      buildSearchMeta('6650f0000000000000000002', '/Sandbox/日本語 ページ'),
    );

    expect(result.path).toBe('/Sandbox/日本語 ページ');
    expect(result.pageId).toBe('6650f0000000000000000002');
  });

  it('does not include search meta in the candidate', () => {
    const result = toPagePathCandidate({
      data: buildData({ _id: '6650f0000000000000000003', path: '/baz' }),
      meta: { bookmarkCount: 3, elasticSearchResult: { snippet: 'hit' } },
    });

    expect(Object.keys(result).sort()).toEqual(['creator', 'pageId', 'path']);
  });

  it('carries the populated creator from the search result, null when absent', () => {
    const creator = mock<IUserHasId>({
      _id: 'u1',
      name: 'Alice',
      username: 'alice',
    });
    const withCreator = toPagePathCandidate({
      data: buildData({ _id: '6650f0000000000000000004', path: '/p', creator }),
      meta: {},
    });
    // Creator carried through to the candidate, not dropped or reshaped.
    expect(withCreator.creator).toEqual(creator);

    // No creator on the page → null (optional, avatar falls back to default).
    const withoutCreator = toPagePathCandidate(
      buildSearchMeta('6650f0000000000000000005', '/q'),
    );
    expect(withoutCreator.creator).toBeNull();
  });
});
