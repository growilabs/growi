import { isErrorV3 } from '@growi/core/dist/models';

import type { AdminRelationListItem } from './types';

export type RelationBadge = 'unpaired' | 'active' | 'connection-lost';

/**
 * Whether a failed connection-status request means the proxy did not accept
 * this GROWI's signature. The server answers that case with an `ErrorV3`
 * whose code is `rejected` (never a 401, which clients read as a lost
 * login); `apiv3` surfaces it as an array of such errors.
 */
export const isConnectionRejected = (error: unknown): boolean => {
  if (!Array.isArray(error)) {
    return false;
  }
  const first: unknown = error[0];
  return isErrorV3(first) && first.code === 'rejected';
};

/**
 * The badge of a relation's row. GROWI's own record only says `active`;
 * "connection lost" is claimed only for a signature rejection, the one
 * signal that the relation is no longer usable. Any other failure to check
 * leaves the record's state as it is -- there is nothing to say it is lost.
 */
export const deriveRelationBadge = (
  state: AdminRelationListItem['state'],
  connectionStatusError: unknown,
): RelationBadge => {
  if (state === 'unpaired') {
    return 'unpaired';
  }
  return isConnectionRejected(connectionStatusError)
    ? 'connection-lost'
    : 'active';
};
