// Which installation an incoming event belongs to, read off the event and the
// adapter serving it. One rule for every caller -- a command, a posted link,
// the bot being added to a channel -- so they cannot drift apart.
//
// The answer comes from declarations, never from the service's name:
//  - an adapter opened for one installation alone already knows it;
//  - an adapter serving many workspaces says through its `ADAPTER_FACTORIES`
//    entry's `workspaceOfEvent`, which may also say the conversation belongs
//    to no workspace (a Discord DM);
//  - a service that declares neither leaves the event unidentified.
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';

import type { EventInstallation } from '../types/index.js';
import type { AdapterFactory } from './adapter-set.js';
import type { InstallationProvider } from './installation-provider.js';

export interface EventInstallationDeps {
  readonly platform: PlatformName;
  /** Set when the adapter was opened for this one installation. */
  readonly installationId?: string;
  readonly factories: Readonly<Record<PlatformName, AdapterFactory>>;
  readonly installations: InstallationProvider;
}

export type EventInstallationLookup =
  | EventInstallation
  /** Nothing the event carries matches a held installation; `reason` says why. */
  | { readonly kind: 'unidentified'; readonly reason: string };

/**
 * Rejects only when the service was asked and failed to answer; every answer
 * it did give is one of the three outcomes.
 */
export const lookUpEventInstallation = async (
  deps: EventInstallationDeps,
  adapter: Adapter,
  channelId: string,
): Promise<EventInstallationLookup> => {
  if (deps.installationId != null) {
    return { kind: 'identified', installationId: deps.installationId };
  }

  const factory = deps.factories[deps.platform];
  const workspaceOf =
    factory.credentialSource === 'app' ? factory.workspaceOfEvent : undefined;
  if (workspaceOf == null) {
    return {
      kind: 'unidentified',
      reason: `${deps.platform} declares no way to tell which workspace the event came from`,
    };
  }

  const workspaceId = await workspaceOf(adapter, channelId);
  if (workspaceId == null) return { kind: 'no-workspace' };

  const listed = await deps.installations.list(deps.platform);
  const found = listed.find(
    (installation) => installation.workspaceId === workspaceId,
  );
  return found == null
    ? {
        kind: 'unidentified',
        reason: `no ${deps.platform} installation is held for workspace ${workspaceId}`,
      }
    : { kind: 'identified', installationId: found.installationId };
};

/**
 * `lookUpEventInstallation` as an event handler needs it: an event that cannot
 * be placed comes back `undefined`, to be placed by the channel inventory, and
 * a failure to ask the service is reported rather than thrown -- the event is
 * still handled.
 */
export const identifyEventInstallation =
  (
    deps: EventInstallationDeps,
    reportOperationalFailure: (message: string, error?: unknown) => void,
  ): ((
    adapter: Adapter,
    channelId: string,
  ) => Promise<EventInstallation | undefined>) =>
  async (adapter, channelId) => {
    try {
      const found = await lookUpEventInstallation(deps, adapter, channelId);
      return found.kind === 'unidentified' ? undefined : found;
    } catch (error) {
      reportOperationalFailure(
        `which ${deps.platform} installation an event came from could not be read; it is placed by the channel inventory instead`,
        error,
      );
      return undefined;
    }
  };
