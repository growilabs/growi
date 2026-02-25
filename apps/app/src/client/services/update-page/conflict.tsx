import type { ErrorV3 } from '@growi/core/dist/models';

import { PageUpdateErrorCode } from '~/interfaces/apiv3';
import type { RemoteRevisionData } from '~/states/page';

export const extractRemoteRevisionDataFromErrorObj = (
  errors: Array<ErrorV3>,
): RemoteRevisionData | undefined => {
  for (const error of errors) {
    if (error.code === PageUpdateErrorCode.CONFLICT) {
      const latestRevision = error.args.returnLatestRevision;

      const remoteRevidsionData = {
        remoteRevisionId: latestRevision.revisionId,
        remoteRevisionBody: latestRevision.revisionBody,
        remoteRevisionLastUpdateUser: latestRevision.user,
        remoteRevisionLastUpdatedAt: latestRevision.createdAt,
      };

      return remoteRevidsionData;
    }
  }
};
