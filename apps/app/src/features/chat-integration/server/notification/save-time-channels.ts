// Requirement 2.2's server half: the channels the person SAVING A PAGE can
// send a notification to, for the picker in the page editor
// (`client/notification/ChatIntegrationDestinationSelect.tsx`).
//
// This is a different screen, and a different requirement, from the admin
// settings screen's destination editor (`admin/notification-destinations.ts`,
// Requirement 2.1): that one configures "every page under this path always
// notifies this channel" and is administrator-only, while this one answers
// "which channels may I pick for THIS save" for any editor. What the two
// share is where the channel list comes from -- `loadChannelInventory` --
// so a destination is picked by IDENTIFIER on both, and the same fetch
// keeps the stored destination names current.
//
// Every option carries its own `relationId`. A channel id is unique only
// within one chat workspace, so without it a picked channel could not be
// routed to the right relation's outbox (see
// `IApiv3ChatIntegrationDestinationInput` in `~/interfaces/apiv3/page`,
// whose shape this deliberately matches field for field).

import { loadChannelInventory } from '../channel-inventory';
import { ChatRelation } from '../models/chat-relation';

/** One pickable channel, plus which paired workspace it belongs to. */
export interface SaveTimeChannelOption {
  readonly relationId: string;
  readonly workspaceName: string;
  readonly platform: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate: boolean;
}

export interface SaveTimeChannelsView {
  readonly channels: readonly SaveTimeChannelOption[];
  /**
   * The paired workspaces whose channel list could not be fetched. Reported
   * rather than swallowed so the editor can say "these workspaces are
   * missing from the list" instead of quietly presenting a short one.
   */
  readonly unavailableRelations: ReadonlyArray<{
    readonly relationId: string;
    readonly workspaceName: string;
    readonly reason: string;
  }>;
}

/**
 * Every channel every ACTIVE relation can post to.
 *
 * An `unpaired` relation is skipped without calling its proxy at all: it
 * has no live integration to notify, and its key may already be revoked.
 *
 * One unreachable proxy does not empty the picker -- the relations that did
 * answer stay pickable and the failure is reported alongside them. The
 * fetches run in parallel because a slow proxy would otherwise add its
 * latency to the editor's load for every other workspace too.
 */
export const buildSaveTimeChannelsView =
  async (): Promise<SaveTimeChannelsView> => {
    const relations = await ChatRelation.find({ state: 'active' })
      .sort({ createdAt: 1 })
      .lean();

    const results = await Promise.all(
      relations.map(async (relation) => ({
        relation,
        inventory: await loadChannelInventory(relation.relationId),
      })),
    );

    const channels: SaveTimeChannelOption[] = [];
    const unavailableRelations: SaveTimeChannelsView['unavailableRelations'][number][] =
      [];

    for (const { relation, inventory } of results) {
      if (!inventory.ok) {
        unavailableRelations.push({
          relationId: relation.relationId,
          workspaceName: relation.workspaceName,
          reason: inventory.reason,
        });
        continue;
      }
      for (const channel of inventory.response.channels) {
        channels.push({
          relationId: relation.relationId,
          workspaceName: relation.workspaceName,
          platform: channel.platform,
          channelId: channel.channelId,
          channelName: channel.channelName,
          isPrivate: channel.isPrivate,
        });
      }
    }

    return { channels, unavailableRelations };
  };
