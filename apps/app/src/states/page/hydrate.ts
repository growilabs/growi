import {
  type IPageInfo,
  type IPageNotFoundInfo,
  type IPagePopulatedToShowRevision,
  isIPageInfoForEmpty,
  isIPageNotFoundInfo,
} from '@growi/core';
import { useHydrateAtoms } from 'jotai/utils';

import {
  currentPageDataAtom,
  currentPageEmptyIdAtom,
  currentPageEntityIdAtom,
  isForbiddenAtom,
  isIdenticalPathAtom,
  pageNotFoundAtom,
  redirectFromAtom,
  remoteRevisionBodyAtom,
  shareLinkIdAtom,
  templateBodyAtom,
  templateTagsAtom,
} from './internal-atoms';

/**
 * Hook for hydrating page-related atoms with server-side data
 * Simplified to focus on the most common use case: hydrating with page data
 *
 * This replaces the complex shouldMutate logic in useSWRxCurrentPage
 * with simple, direct atom initialization
 *
 * Data sources:
 * - page._id, page.revision -> Auto-extracted from IPagePopulatedToShowRevision
 * - remoteRevisionBody -> Auto-extracted from page.revision
 * - templateTags, templateBody -> Explicitly provided via options
 *
 * @example
 * // Basic usage
 * useHydratePageAtoms(pageWithMeta?.data);
 *
 * // With template data and custom flags
 * useHydratePageAtoms(pageWithMeta?.data, {
 *   templateTags: ['tag1', 'tag2'],
 *   templateBody: 'Template content'
 * });
 */
export const useHydratePageAtoms = (
  page: IPagePopulatedToShowRevision | null | undefined,
  pageMeta: IPageNotFoundInfo | IPageInfo | undefined,
  options?: {
    // always overwrited
    shareLinkId?: string;
    redirectFrom?: string;
    templateTags?: string[];
    templateBody?: string;
    isIdenticalPath?: boolean;
  },
): void => {
  useHydrateAtoms([
    // Core page state - automatically extract from page object
    [currentPageEntityIdAtom, page?._id],
    [currentPageDataAtom, page ?? undefined],
    [pageNotFoundAtom, isIPageNotFoundInfo(pageMeta)],
    [
      isForbiddenAtom,
      isIPageNotFoundInfo(pageMeta) ? pageMeta.isForbidden : false,
    ],
    [
      currentPageEmptyIdAtom,
      isIPageInfoForEmpty(pageMeta) ? pageMeta.emptyPageId : undefined,
    ],

    // Remote revision data - used by ConflictDiffModal
    [remoteRevisionBodyAtom, page?.revision?.body],
  ]);

  // always overwrited
  useHydrateAtoms(
    [
      // ShareLink page state
      [shareLinkIdAtom, options?.shareLinkId],

      [redirectFromAtom, options?.redirectFrom ?? undefined],
      [isIdenticalPathAtom, options?.isIdenticalPath ?? false],

      // Template data - from options (not auto-extracted from page)
      [templateTagsAtom, options?.templateTags ?? []],
      [templateBodyAtom, options?.templateBody ?? ''],
    ],
    { dangerouslyForceHydrate: true },
  );
};
