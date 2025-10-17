import type { JSX } from 'react';
import { useAtomValue } from 'jotai';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useCurrentPageData } from '~/states/page';
import { elasticsearchMaxBodyLengthToIndexAtom } from '~/states/server-configurations';

export const FullTextSearchNotCoverAlertLazyLoaded = (): JSX.Element => {
  const pageData = useCurrentPageData();
  const elasticsearchMaxBodyLengthToIndex = useAtomValue(elasticsearchMaxBodyLengthToIndexAtom);

  const markdownLength = pageData?.revision?.body?.length;
  const isActive = markdownLength != null
    && elasticsearchMaxBodyLengthToIndex != null
    && markdownLength > elasticsearchMaxBodyLengthToIndex;

  const FullTextSearchNotCoverAlert = useLazyLoader<Record<string, unknown>>(
    'full-text-search-not-cover-alert',
    () => import('./FullTextSearchNotCoverAlert').then((mod) => ({ default: mod.FullTextSearchNotCoverAlert })),
    isActive,
  );

  return FullTextSearchNotCoverAlert ? <FullTextSearchNotCoverAlert /> : <></>;
};
