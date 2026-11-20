import { useCallback, useMemo, useState } from 'react';

import type { InlineCommentWithReplies } from '../../interfaces';
import type { InlineCommentListMenuItem } from '../components/InlineCommentListMenu/InlineCommentListMenu';

type ResolveFn = (id: string, resolved: boolean) => Promise<unknown>;

type UseResolvedCollapseResult = {
  isCollapsed: (comment: InlineCommentWithReplies) => boolean;
  expand: (id: string) => void;
  collapse: (id: string) => void;
  resolve: ResolveFn;
  listMenuItems: readonly InlineCommentListMenuItem[];
};

export const isCollapsed = (
  comment: Pick<InlineCommentWithReplies, 'id' | 'resolvedAt'>,
  expanded: ReadonlySet<string>,
): boolean => comment.resolvedAt != null && !expanded.has(comment.id);

export const useResolvedCollapse = (
  comments: readonly InlineCommentWithReplies[],
  resolve: ResolveFn,
): UseResolvedCollapseResult => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const expand = useCallback((id: string): void => {
    setExpanded((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }, []);

  const collapse = useCallback((id: string): void => {
    setExpanded((prev) =>
      prev.has(id)
        ? new Set([...prev].filter((expandedId) => expandedId !== id))
        : prev,
    );
  }, []);

  const wrappedResolve = useCallback(
    async (id: string, resolved: boolean): Promise<unknown> => {
      const result = await resolve(id, resolved);
      collapse(id);
      return result;
    },
    [resolve, collapse],
  );

  const isCollapsedInState = useCallback(
    (comment: InlineCommentWithReplies): boolean =>
      isCollapsed(comment, expanded),
    [expanded],
  );

  const listMenuItems = useMemo((): readonly InlineCommentListMenuItem[] => {
    const resolvedIds = comments
      .filter((comment) => comment.resolvedAt != null)
      .map((comment) => comment.id);

    return [
      {
        id: 'expand-all-resolved',
        labelKey: 'inline_comment.expand_all_resolved',
        disabled: resolvedIds.length === 0,
        onSelect: () => {
          setExpanded((prev) => new Set([...prev, ...resolvedIds]));
        },
      },
    ];
  }, [comments]);

  return {
    isCollapsed: isCollapsedInState,
    expand,
    collapse,
    resolve: wrappedResolve,
    listMenuItems,
  };
};
