import type { JSX } from 'react';
import { useAtomValue } from 'jotai';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { useCurrentPageData } from '~/states/page/index.js';
import { elasticsearchMaxBodyLengthToIndexAtom } from '~/states/server-configurations/index.js';

import type { FullTextSearchNotCoverAlertProps } from './FullTextSearchNotCoverAlert.js';

export const FullTextSearchNotCoverAlertLazyLoaded = (): JSX.Element => {
  const pageData = useCurrentPageData();
  const elasticsearchMaxBodyLengthToIndex = useAtomValue(
    elasticsearchMaxBodyLengthToIndexAtom,
  );

  const markdownLength = pageData?.revision?.body?.length;

  // Calculate whether the alert should be shown
  const shouldShow =
    markdownLength != null &&
    elasticsearchMaxBodyLengthToIndex != null &&
    markdownLength > elasticsearchMaxBodyLengthToIndex;

  // Load component when it should be shown (loads once and stays cached)
  const FullTextSearchNotCoverAlert =
    useLazyLoader<FullTextSearchNotCoverAlertProps>(
      'full-text-search-not-cover-alert',
      () =>
        import('./FullTextSearchNotCoverAlert.js').then((mod) => ({
          default: mod.FullTextSearchNotCoverAlert,
        })),
      shouldShow,
    );

  // Pass active state to control visibility
  return FullTextSearchNotCoverAlert ? (
    <FullTextSearchNotCoverAlert isActive={shouldShow} />
  ) : (
    <></>
  );
};
