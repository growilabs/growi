import { PageStatus } from '@growi/core';
import type { Types } from 'mongoose';

import type { LinkTargetState } from '../../interfaces/backlink';

/**
 * Derive one outbound link's target state. Nothing is stored, so a restore needs no write.
 *
 * The caller must already have established that `toPage`'s page exists and is readable —
 * a row whose target was not found is *omitted* from a health read, never derived (see
 * `find-forward-link-health`). A `null`/`undefined` status is a v4-era page, which
 * `addConditionToExcludeTrashed` counts as published.
 */
export const deriveLinkTargetState = (
  toPage: Types.ObjectId | null,
  targetStatus: string | null | undefined,
): LinkTargetState => {
  // Outranks the status check: with no cached target, a status describes no page.
  if (toPage == null) {
    return 'broken';
  }

  return targetStatus === PageStatus.STATUS_DELETED ? 'trashed' : 'normal';
};
