import { useCallback } from 'react';
import {
  type IPageInfo,
  type IPageNotFoundInfo,
  type IPagePopulatedToShowRevision,
  isIPageInfoForEmpty,
  isIPageNotFoundInfo,
} from '@growi/core';
import type { PrimitiveAtom } from 'jotai';
import { useAtomCallback, useHydrateAtoms } from 'jotai/utils';

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

type PageAtomWriter = <V>(atom: PrimitiveAtom<V>, value: V) => void;

const writePageAtoms = (
  write: PageAtomWriter,
  page: IPagePopulatedToShowRevision | null | undefined,
  pageMeta: IPageNotFoundInfo | IPageInfo | undefined,
): void => {
  // Core page state - automatically extract from page object
  write(currentPageEntityIdAtom, page?._id);
  write(currentPageDataAtom, page ?? undefined);
  write(pageNotFoundAtom, isIPageNotFoundInfo(pageMeta));
  write(
    isForbiddenAtom,
    isIPageNotFoundInfo(pageMeta) ? pageMeta.isForbidden : false,
  );
  write(
    currentPageEmptyIdAtom,
    isIPageInfoForEmpty(pageMeta) ? pageMeta.emptyPageId : undefined,
  );

  // Remote revision data - used by ConflictDiffModal
  write(remoteRevisionBodyAtom, page?.revision?.body);
};

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
  const pageAtomValues = new Map();
  writePageAtoms(
    (atom, value) => pageAtomValues.set(atom, value),
    page,
    pageMeta,
  );
  useHydrateAtoms(pageAtomValues);

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

/**
 * Returns a setter that overwrites the page atoms with server-side data,
 * the same values useHydratePageAtoms writes on the first render.
 *
 * useHydratePageAtoms writes only once, so a route whose props carry the
 * navigated-to page uses this to apply it on client-side navigation.
 */
export const useSetPageAtoms = (): ((
  page: IPagePopulatedToShowRevision | null | undefined,
  pageMeta: IPageNotFoundInfo | IPageInfo | undefined,
) => void) =>
  useAtomCallback(
    useCallback((_get, set, page, pageMeta) => {
      writePageAtoms((atom, value) => set(atom, value), page, pageMeta);
    }, []),
  );
