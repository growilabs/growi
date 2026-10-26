// What the bot being added to a channel sets off: the channel inventory of the
// installation it was added in is taken again right away. Commands resolve a
// channel to its installation through that inventory
// (`runtime/dependencies.ts`'s `resolveInstallationId`), so without this a
// channel the bot was just invited to answers 「workspace がまだ登録されて
// いません」 until the periodic refresh comes round.
//
// The refresh itself is not done here: `refreshChannels` is the same closure
// `InstallationStore.save()` and the sweeper run, so all three refresh by one
// rule (a failed listing leaves the saved inventory as it was).
//
// Which installation the event belongs to is the only per-service question,
// and it is answered from declarations, never from the service's name:
//  - an adapter opened for one installation alone already knows it;
//  - an adapter serving many workspaces says through its `ADAPTER_FACTORIES`
//    entry's `workspaceOfEvent`;
//  - a service that declares neither is reported, and left to the periodic
//    refresh.
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';

import type { AdapterFactory } from './adapter-set.js';
import type { InstallationProvider } from './installation-provider.js';

export interface BotJoinedChannelDeps {
  readonly platform: PlatformName;
  /** Set when the adapter was opened for this one installation. */
  readonly installationId?: string;
  readonly factories: Readonly<Record<PlatformName, AdapterFactory>>;
  readonly installations: InstallationProvider;
  readonly refreshChannels: (installationId: string) => Promise<void>;
  readonly reportOperationalFailure: (message: string, error?: unknown) => void;
}

/** Thrown inside this file only, so the report can name what was missing. */
class UnidentifiedInstallationError extends Error {}

const installationOfEvent = async (
  deps: BotJoinedChannelDeps,
  adapter: Adapter,
): Promise<string> => {
  if (deps.installationId != null) return deps.installationId;

  const factory = deps.factories[deps.platform];
  const workspaceOf =
    factory.credentialSource === 'app' ? factory.workspaceOfEvent : undefined;
  if (workspaceOf == null) {
    throw new UnidentifiedInstallationError(
      `${deps.platform} declares no way to tell which workspace the event came from`,
    );
  }

  const workspaceId = await workspaceOf(adapter);
  const listed = await deps.installations.list(deps.platform);
  const found = listed.find(
    (installation) => installation.workspaceId === workspaceId,
  );
  if (found == null) {
    throw new UnidentifiedInstallationError(
      `no ${deps.platform} installation is held for workspace ${workspaceId}`,
    );
  }
  return found.installationId;
};

/**
 * The handler for "the bot itself was added to a channel" on one adapter.
 * Never rejects: every failure is reported instead, and the saved inventory
 * stays the last one actually taken.
 */
export const refreshOnBotJoin =
  (deps: BotJoinedChannelDeps): ((adapter: Adapter) => Promise<void>) =>
  async (adapter) => {
    let installationId: string;
    try {
      installationId = await installationOfEvent(deps, adapter);
    } catch (error) {
      const detail =
        error instanceof UnidentifiedInstallationError
          ? `: ${error.message}`
          : '';
      deps.reportOperationalFailure(
        `the bot was added to a ${deps.platform} channel, but which installation it belongs to could not be told${detail}; its channel inventory waits for the periodic refresh`,
        error,
      );
      return;
    }

    try {
      await deps.refreshChannels(installationId);
    } catch (error) {
      deps.reportOperationalFailure(
        `the channel inventory of installation ${installationId} could not be refreshed after the bot was added to a channel; the periodic refresh will retry`,
        error,
      );
    }
  };
