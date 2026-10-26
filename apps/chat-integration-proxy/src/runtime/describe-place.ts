import { inventoryChannelIdOfEvent } from '../capabilities/index.js';
import type {
  InstallationChannelRepository,
  InstallationRepository,
} from '../db/index.js';
import type { SdkChannelRef } from '../types/index.js';

export interface DescribePlaceSources {
  readonly installations: Pick<InstallationRepository, 'listByPlatform'>;
  readonly channels: Pick<InstallationChannelRepository, 'find'>;
}

/**
 * The saved inventory's name for the channel an event came from, or `null`
 * when no installation of that service lists it. A name is only a label for
 * the reply, so a missing one is an answer, not a failure.
 */
export const describePlace = async (
  { installations, channels }: DescribePlaceSources,
  channel: SdkChannelRef,
): Promise<string | null> => {
  const candidates = await installations.listByPlatform(channel.platform);
  const channelId = inventoryChannelIdOfEvent(channel);
  for (const candidate of candidates) {
    // biome-ignore lint/performance/noAwaitInLoops: stops at the first match, the same lookup `resolveInstallationId` makes
    const found = await channels.find(candidate.installationId, channelId);
    if (found != null) return found.channelName;
  }
  return null;
};
