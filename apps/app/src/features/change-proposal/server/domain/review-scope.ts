import type { OperationRecord } from '../../interfaces';

// Pages a reviewer must be able to view to decide an operation.
export type ReviewScope = {
  readonly pageIds: readonly string[];
  // Parent candidates for a page that does not exist yet, longest path first.
  readonly ancestorPaths: readonly string[];
};

// Mirrors core's findNonEmptyClosestAncestor: walk up from the parent to the root.
const ancestorCandidatesOf = (path: string): readonly string[] => {
  const candidates: string[] = [];
  let current = path;
  while (current !== '/') {
    const slash = current.lastIndexOf('/');
    current = slash <= 0 ? '/' : current.slice(0, slash);
    candidates.push(current);
  }
  return candidates;
};

// A complete deletion never decides reviewers (see design.md, review-scope).
export const reviewScopeOf = (op: OperationRecord): ReviewScope => {
  switch (op.type) {
    case 'edit':
    case 'delete-completely':
      return { pageIds: [op.pageId], ancestorPaths: [] };
    case 'create':
      return { pageIds: [], ancestorPaths: ancestorCandidatesOf(op.path) };
    case 'move':
      return {
        pageIds: [op.pageId],
        ancestorPaths: ancestorCandidatesOf(op.toPath),
      };
  }
};

// existingPaths must hold only non-empty pages, so empty pages are skipped.
export const resolveAncestors = (
  candidatePaths: readonly string[],
  existingPaths: ReadonlySet<string>,
): string | null => candidatePaths.find((p) => existingPaths.has(p)) ?? null;
