import {
  type IPageInfo,
  type IPageNotFoundInfo,
  type IPagePopulatedToShowRevision,
  isIPageInfo,
  isIPageNotFoundInfo,
} from '@growi/core';
import { useHydrateAtoms } from 'jotai/utils';

import {
  currentPageDataAtom,
  currentPageIdAtom,
  isForbiddenAtom,
  latestRevisionAtom,
  pageNotFoundAtom,
  redirectFromAtom,
  remoteRevisionBodyAtom,
  remoteRevisionIdAtom,
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
 * - remoteRevisionId, remoteRevisionBody -> Auto-extracted from page.revision
 * - templateTags, templateBody, isLatestRevision -> Explicitly provided via options
 *
 * @example
 * // Basic usage
 * useHydratePageAtoms(pageWithMeta?.data);
 *
 * // With template data and custom flags
 * useHydratePageAtoms(pageWithMeta?.data, {
 *   isLatestRevision: false,
 *   templateTags: ['tag1', 'tag2'],
 *   templateBody: 'Template content'
 * });
 */
export const useHydratePageAtoms = (
  page: IPagePopulatedToShowRevision | null | undefined,
  pageMeta: IPageNotFoundInfo | IPageInfo | undefined,
  options?: {
    // always overwrited
    isLatestRevision?: boolean;
    shareLinkId?: string;
    redirectFrom?: string;
    templateTags?: string[];
    templateBody?: string;
  },
): void => {
  useHydrateAtoms([
    // Core page state - automatically extract from page object
    [currentPageIdAtom, page?._id],
    [currentPageDataAtom, page ?? undefined],
    [
      pageNotFoundAtom,
      isIPageInfo(pageMeta)
        ? pageMeta.isNotFound
        : page == null || page.isEmpty,
    ],
    [
      isForbiddenAtom,
      isIPageNotFoundInfo(pageMeta) ? pageMeta.isForbidden : false,
    ],

    // Remote revision data - auto-extracted from page.revision
    [remoteRevisionIdAtom, page?.revision?._id],
    [remoteRevisionBodyAtom, page?.revision?.body],
  ]);

  // always overwrited
  useHydrateAtoms(
    [
      [latestRevisionAtom, options?.isLatestRevision ?? true],

      // ShareLink page state
      [shareLinkIdAtom, options?.shareLinkId],

      [redirectFromAtom, options?.redirectFrom ?? undefined],

      // Template data - from options (not auto-extracted from page)
      [templateTagsAtom, options?.templateTags ?? []],
      [templateBodyAtom, options?.templateBody ?? ''],
    ],
    { dangerouslyForceHydrate: true },
  );
};
