// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';

import type { InlineCommentWithReplies } from '../../interfaces';
import { isCollapsed, useResolvedCollapse } from './use-resolved-collapse';

const RESOLVED_AT = new Date('2026-01-02T00:00:00.000Z');

const buildComment = (
  overrides: Partial<InlineCommentWithReplies> = {},
): InlineCommentWithReplies => ({
  id: 'comment1',
  pageId: 'page1',
  creatorId: 'user1',
  creator: null,
  comment: 'the comment body',
  anchorOriginRevisionId: 'revision1',
  anchor: {
    quote: 'the quoted range',
    prefix: '',
    suffix: '',
    approxOffset: 0,
  },
  resolvedById: null,
  resolvedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  replies: [],
  ...overrides,
});

const resolvedComment = (id: string): InlineCommentWithReplies =>
  buildComment({ id, resolvedById: 'user1', resolvedAt: RESOLVED_AT });

const unresolvedComment = (id: string): InlineCommentWithReplies =>
  buildComment({ id });

const noopResolve = (): Promise<unknown> => Promise.resolve();

describe('isCollapsed', () => {
  it('treats an unresolved comment as expanded whether or not it is in the set', () => {
    expect(isCollapsed(unresolvedComment('a'), new Set())).toBe(false);
    expect(isCollapsed(unresolvedComment('a'), new Set(['a']))).toBe(false);
  });

  it('collapses a resolved comment by default', () => {
    expect(isCollapsed(resolvedComment('a'), new Set())).toBe(true);
  });

  it('expands a resolved comment whose id is in the expanded set', () => {
    expect(isCollapsed(resolvedComment('a'), new Set(['a']))).toBe(false);
    expect(isCollapsed(resolvedComment('a'), new Set(['b']))).toBe(true);
  });

  it('does not change the expanded set it is given', () => {
    const expanded = new Set(['a']);

    isCollapsed(resolvedComment('a'), expanded);
    isCollapsed(resolvedComment('b'), expanded);

    expect([...expanded]).toEqual(['a']);
  });
});

describe('useResolvedCollapse', () => {
  describe('expand / collapse', () => {
    it('starts with every resolved comment collapsed and unresolved ones expanded', () => {
      const comments = [resolvedComment('r1'), unresolvedComment('u1')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, noopResolve),
      );

      expect(result.current.isCollapsed(comments[0])).toBe(true);
      expect(result.current.isCollapsed(comments[1])).toBe(false);
    });

    it('expands only the targeted comment', () => {
      const comments = [resolvedComment('r1'), resolvedComment('r2')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, noopResolve),
      );

      act(() => {
        result.current.expand('r1');
      });

      expect(result.current.isCollapsed(comments[0])).toBe(false);
      expect(result.current.isCollapsed(comments[1])).toBe(true);
    });

    it('collapses only the targeted comment', () => {
      const comments = [resolvedComment('r1'), resolvedComment('r2')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, noopResolve),
      );

      act(() => {
        result.current.expand('r1');
        result.current.expand('r2');
      });
      act(() => {
        result.current.collapse('r1');
      });

      expect(result.current.isCollapsed(comments[0])).toBe(true);
      expect(result.current.isCollapsed(comments[1])).toBe(false);
    });

    it('never changes what an earlier render observed', () => {
      const comments = [resolvedComment('r1'), resolvedComment('r2')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, noopResolve),
      );

      const initialIsCollapsed = result.current.isCollapsed;
      act(() => {
        result.current.expand('r1');
      });
      const afterExpandIsCollapsed = result.current.isCollapsed;
      act(() => {
        result.current.collapse('r1');
        result.current.expand('r2');
      });

      // A mutated set would leak later updates into the earlier snapshots.
      expect(initialIsCollapsed(comments[0])).toBe(true);
      expect(initialIsCollapsed(comments[1])).toBe(true);
      expect(afterExpandIsCollapsed(comments[0])).toBe(false);
      expect(afterExpandIsCollapsed(comments[1])).toBe(true);
    });
  });

  describe('wrapped resolve', () => {
    it('passes the arguments through and returns the underlying result', async () => {
      const resolve = vi.fn(async () => 'result');
      const comments = [resolvedComment('r1')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, resolve),
      );

      let returned: unknown;
      await act(async () => {
        returned = await result.current.resolve('r1', false);
      });

      expect(resolve).toHaveBeenCalledWith('r1', false);
      expect(returned).toBe('result');
    });

    it('collapses the comment again after un-resolving and re-resolving it', async () => {
      const { result, rerender } = renderHook(
        ({ comments }) => useResolvedCollapse(comments, noopResolve),
        { initialProps: { comments: [resolvedComment('r1')] } },
      );

      act(() => {
        result.current.expand('r1');
      });

      await act(async () => {
        await result.current.resolve('r1', false);
      });
      const unresolved = unresolvedComment('r1');
      rerender({ comments: [unresolved] });
      expect(result.current.isCollapsed(unresolved)).toBe(false);

      await act(async () => {
        await result.current.resolve('r1', true);
      });
      const reResolved = resolvedComment('r1');
      rerender({ comments: [reResolved] });
      expect(result.current.isCollapsed(reResolved)).toBe(true);
    });

    it('clears the expanded record when resolving succeeds', async () => {
      const comments = [resolvedComment('r1')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, noopResolve),
      );

      act(() => {
        result.current.expand('r1');
      });
      await act(async () => {
        await result.current.resolve('r1', true);
      });

      expect(result.current.isCollapsed(comments[0])).toBe(true);
    });

    it('keeps the expanded record and rethrows when resolving fails', async () => {
      const failure = new Error('resolve failed');
      const resolve = (): Promise<unknown> => Promise.reject(failure);
      const comments = [resolvedComment('r1')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, resolve),
      );

      act(() => {
        result.current.expand('r1');
      });
      await act(async () => {
        await expect(result.current.resolve('r1', false)).rejects.toBe(failure);
      });

      expect(result.current.isCollapsed(comments[0])).toBe(false);
    });
  });

  describe('listMenuItems', () => {
    it('offers the expand-all-resolved item', () => {
      const { result } = renderHook(() =>
        useResolvedCollapse([resolvedComment('r1')], noopResolve),
      );

      expect(result.current.listMenuItems).toEqual([
        expect.objectContaining({
          labelKey: 'inline_comment.expand_all_resolved',
          disabled: false,
        }),
      ]);
    });

    it('disables the item when there are no resolved comments', () => {
      const { result } = renderHook(() =>
        useResolvedCollapse([unresolvedComment('u1')], noopResolve),
      );

      expect(result.current.listMenuItems[0].disabled).toBe(true);
    });

    it('expands every resolved comment and leaves unresolved ones out of the record', () => {
      const { result, rerender } = renderHook(
        ({ comments }) => useResolvedCollapse(comments, noopResolve),
        {
          initialProps: {
            comments: [
              resolvedComment('r1'),
              resolvedComment('r2'),
              unresolvedComment('u1'),
            ],
          },
        },
      );

      act(() => {
        result.current.listMenuItems[0].onSelect();
      });

      expect(result.current.isCollapsed(resolvedComment('r1'))).toBe(false);
      expect(result.current.isCollapsed(resolvedComment('r2'))).toBe(false);

      // u1 gets resolved elsewhere (not through the wrapped resolve, which
      // would clear the record anyway): had the bulk expand recorded u1, it
      // would now show expanded.
      const u1Resolved = resolvedComment('u1');
      rerender({
        comments: [resolvedComment('r1'), resolvedComment('r2'), u1Resolved],
      });
      expect(result.current.isCollapsed(u1Resolved)).toBe(true);
    });

    it('keeps comments expanded before the bulk expand expanded', () => {
      const comments = [resolvedComment('r1'), resolvedComment('r2')];
      const { result } = renderHook(() =>
        useResolvedCollapse(comments, noopResolve),
      );

      act(() => {
        result.current.expand('r1');
      });
      act(() => {
        result.current.listMenuItems[0].onSelect();
      });

      expect(result.current.isCollapsed(comments[0])).toBe(false);
      expect(result.current.isCollapsed(comments[1])).toBe(false);
    });
  });
});
