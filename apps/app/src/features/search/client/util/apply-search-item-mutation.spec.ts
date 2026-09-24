import type { IPageHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

import { applySearchItemMutation } from './apply-search-item-mutation';

const createPage = (
  id: string,
  path: string,
  highlightedPath?: string,
): IPageWithSearchMeta => ({
  data: mock<IPageHasId>({ _id: id, path }),
  meta: { elasticSearchResult: { snippet: 'snippet', highlightedPath } },
});

const createChunk = (pages: IPageWithSearchMeta[]): IFormattedSearchResult => ({
  data: pages,
  meta: { total: 100, took: 1, hitsCount: pages.length },
});

const pathsOf = (chunk: IFormattedSearchResult): string[] =>
  chunk.data.map((page) => page.data.path);

describe('applySearchItemMutation', () => {
  describe('deleted', () => {
    const chunk = createChunk([
      createPage('a', '/foo'),
      createPage('b', '/foo/child'),
      createPage('c', '/foobar'),
      createPage('d', '/other'),
    ]);

    it('removes only the deleted page when not recursive', () => {
      const result = applySearchItemMutation(chunk, {
        type: 'deleted',
        path: '/foo',
        isRecursively: false,
      });

      expect(pathsOf(result)).toEqual(['/foo/child', '/foobar', '/other']);
    });

    it('also removes descendants when recursive, but not a sibling sharing the prefix', () => {
      const result = applySearchItemMutation(chunk, {
        type: 'deleted',
        path: '/foo',
        isRecursively: true,
      });

      expect(pathsOf(result)).toEqual(['/foobar', '/other']);
    });

    it('keeps meta as returned by Elasticsearch so end-of-results detection is unaffected', () => {
      const result = applySearchItemMutation(chunk, {
        type: 'deleted',
        path: '/foo',
        isRecursively: true,
      });

      expect(result.meta).toEqual(chunk.meta);
    });

    it('does not mutate the input chunk', () => {
      applySearchItemMutation(chunk, {
        type: 'deleted',
        path: '/foo',
        isRecursively: true,
      });

      expect(pathsOf(chunk)).toEqual([
        '/foo',
        '/foo/child',
        '/foobar',
        '/other',
      ]);
    });
  });

  describe('renamed', () => {
    const chunk = createChunk([
      createPage('a', '/foo', '<em>/foo</em>'),
      createPage('b', '/foo/child'),
      createPage('c', '/foobar', '<em>/foobar</em>'),
    ]);

    it('rewrites the renamed page and its descendants, but not a sibling sharing the prefix', () => {
      const result = applySearchItemMutation(chunk, {
        type: 'renamed',
        fromPath: '/foo',
        toPath: '/moved/foo',
      });

      expect(pathsOf(result)).toEqual([
        '/moved/foo',
        '/moved/foo/child',
        '/foobar',
      ]);
    });

    it('drops the stale highlighted path of rewritten rows only', () => {
      const result = applySearchItemMutation(chunk, {
        type: 'renamed',
        fromPath: '/foo',
        toPath: '/moved/foo',
      });

      const highlighted = result.data.map(
        (page) => page.meta?.elasticSearchResult?.highlightedPath,
      );
      expect(highlighted).toEqual([undefined, undefined, '<em>/foobar</em>']);
      expect(result.data[0].meta?.elasticSearchResult?.snippet).toBe('snippet');
    });

    it('keeps row identity (ids) and order', () => {
      const result = applySearchItemMutation(chunk, {
        type: 'renamed',
        fromPath: '/foo',
        toPath: '/moved/foo',
      });

      expect(result.data.map((page) => page.data._id)).toEqual(['a', 'b', 'c']);
    });

    it('does not mutate the input chunk', () => {
      applySearchItemMutation(chunk, {
        type: 'renamed',
        fromPath: '/foo',
        toPath: '/moved/foo',
      });

      expect(pathsOf(chunk)).toEqual(['/foo', '/foo/child', '/foobar']);
    });
  });
});
