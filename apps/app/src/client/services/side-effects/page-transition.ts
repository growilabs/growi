import { useCallback, useEffect } from 'react';

import {
  useCurrentPageData, useShareLinkId, useSetIsLatestRevision, useRevisionIdFromUrl,
} from '~/states/page';
import { useSWRxPageInfo } from '~/stores/page';


export const usePageTransitionEffect = (): void => {
  const setIsLatestRevision = useSetIsLatestRevision();
  const currentPage = useCurrentPageData();
  const shareLinkId = useShareLinkId();
  const revisionIdFromUrl = useRevisionIdFromUrl();
  const { mutate: mutatePageInfo } = useSWRxPageInfo(currentPage?._id, shareLinkId);

  const pageTransitionHandler = useCallback(async() => {
    const pageInfo = await mutatePageInfo();
    const latestRevisionId = pageInfo && 'latestRevisionId' in pageInfo
      ? pageInfo.latestRevisionId
      : undefined;

    const isLatestRevision = revisionIdFromUrl != null
      ? revisionIdFromUrl === latestRevisionId
      : currentPage?.revision?._id === latestRevisionId;

    setIsLatestRevision(isLatestRevision);
  }, [currentPage?.revision?._id, mutatePageInfo, revisionIdFromUrl, setIsLatestRevision]);

  useEffect(() => {
    if (currentPage?._id == null) {
      return;
    }

    pageTransitionHandler();
  }, [currentPage?._id, pageTransitionHandler]);
};
