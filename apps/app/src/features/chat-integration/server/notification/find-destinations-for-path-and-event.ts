import { generatePathsToMatch } from '~/server/util/generate-paths-to-match';

import { ChatNotificationDestination } from '../models/chat-notification-destination';
import type { Gen2Destination } from './destination-registry';

/**
 * Resolves the Gen 2 destinations an admin configured for a given page path
 * + event (Requirement 2.1, 12.2) -- the Gen 2 counterpart of Gen 1's
 * `GlobalNotificationSetting.findSettingByPathAndEvent`. Reuses the SAME
 * shared `generatePathsToMatch` so path-scoped matching behaves identically
 * for Gen 1 and Gen 2 (design.md "パス条件の突き合わせを二重に書かない").
 */
export const findGen2DestinationsForPathAndEvent = async (
  path: string,
  event: string,
): Promise<Gen2Destination[]> => {
  const pathsToMatch = generatePathsToMatch(path);

  const destinations = await ChatNotificationDestination.find({
    pathPattern: { $in: pathsToMatch },
    triggerEvents: event,
  });

  return destinations.map((destination) => ({
    relationId: destination.relationId,
    platform: destination.platform,
    channelId: destination.channelId,
  }));
};
