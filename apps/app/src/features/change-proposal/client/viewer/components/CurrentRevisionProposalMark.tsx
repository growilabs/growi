import { type JSX, useMemo } from 'react';
import {
  getIdStringForRef,
  isIPageInfoForEntity,
} from '@growi/core/dist/interfaces';

import { useIsGuestUser, useIsSharedUser } from '~/states/context';
import { useSWRxPageInfo } from '~/stores/page';

import { useSWRxRevisionMarks } from '../stores/use-swrx-revision-marks';
import { ProposalMarkBadge } from './ProposalMarkBadge';

type CurrentRevisionProposalMarkProps = { readonly pageId: string };

export const CurrentRevisionProposalMark = ({
  pageId,
}: CurrentRevisionProposalMarkProps): JSX.Element | null => {
  const isGuestUser = useIsGuestUser();
  const isSharedUser = useIsSharedUser();
  const isUnavailable = isGuestUser || isSharedUser;

  const { data: pageInfo } = useSWRxPageInfo(isUnavailable ? null : pageId);

  const latestRevisionId = isIPageInfoForEntity(pageInfo)
    ? getIdStringForRef(pageInfo.latestRevisionId)
    : null;

  const revisionIds = useMemo(
    () =>
      isUnavailable || latestRevisionId == null ? null : [latestRevisionId],
    [isUnavailable, latestRevisionId],
  );

  const { marks } = useSWRxRevisionMarks(revisionIds);

  const mark =
    latestRevisionId == null ? undefined : marks.get(latestRevisionId);
  if (isUnavailable || mark == null) {
    return null;
  }

  return <ProposalMarkBadge mark={mark} size="sm" />;
};
