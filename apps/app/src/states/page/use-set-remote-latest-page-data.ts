import { useCallback } from 'react';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import { useSetAtom } from 'jotai/react';

import {
  remoteRevisionBodyAtom,
  remoteRevisionIdAtom,
  remoteRevisionLastUpdatedAtAtom,
  remoteRevisionLastUpdateUserAtom,
} from './internal-atoms';

export type RemoteRevisionData = {
  remoteRevisionId: string;
  remoteRevisionBody: string;
  remoteRevisionLastUpdateUser?: IUserHasId;
  remoteRevisionLastUpdatedAt: Date;
};

type SetRemoteLatestPageData = (pageData: RemoteRevisionData) => void;

/**
 * Set remote data all at once
 */
export const useSetRemoteLatestPageData = (): SetRemoteLatestPageData => {
  const setRemoteRevisionId = useSetAtom(remoteRevisionIdAtom);
  const setRemoteRevisionBody = useSetAtom(remoteRevisionBodyAtom);
  const setRemoteRevisionLastUpdateUser = useSetAtom(
    remoteRevisionLastUpdateUserAtom,
  );
  const setRemoteRevisionLastUpdatedAt = useSetAtom(
    remoteRevisionLastUpdatedAtAtom,
  );

  return useCallback(
    (remoteRevisionData: RemoteRevisionData) => {
      setRemoteRevisionId(remoteRevisionData.remoteRevisionId);
      setRemoteRevisionBody(remoteRevisionData.remoteRevisionBody);
      setRemoteRevisionLastUpdateUser(
        remoteRevisionData.remoteRevisionLastUpdateUser,
      );
      setRemoteRevisionLastUpdatedAt(
        remoteRevisionData.remoteRevisionLastUpdatedAt,
      );
    },
    [
      setRemoteRevisionLastUpdateUser,
      setRemoteRevisionLastUpdatedAt,
      setRemoteRevisionBody,
      setRemoteRevisionId,
    ],
  );
};
