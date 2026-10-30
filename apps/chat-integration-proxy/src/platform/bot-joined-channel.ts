// What the bot being added to a channel sets off: the channel inventory of the
// installation it was added in is taken again right away. The inventory is
// what notification destinations are checked against and what a command falls
// back to when its event names no installation, so a channel the bot was just
// invited to is usable without waiting for the periodic refresh.
//
// The refresh itself is not done here: `refreshChannels` is the same closure
// `InstallationStore.save()` and the sweeper run, so all three refresh by one
// rule (a failed listing leaves the saved inventory as it was).
//
// Which installation the event belongs to is answered by
// `lookUpEventInstallation`, the same rule a command is placed by; an event it
// cannot place is reported and left to the periodic refresh.
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';

import type { AdapterFactory } from './adapter-set.js';
import { lookUpEventInstallation } from './event-installation.js';
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
  channelId: string,
): Promise<string> => {
  const found = await lookUpEventInstallation(deps, adapter, channelId);
  switch (found.kind) {
    case 'identified':
      return found.installationId;
    case 'no-workspace':
      throw new UnidentifiedInstallationError(
        `${deps.platform} says the conversation belongs to no workspace`,
      );
    case 'unidentified':
      throw new UnidentifiedInstallationError(found.reason);
  }
};

/**
 * The handler for "the bot itself was added to a channel" on one adapter.
 * Never rejects: every failure is reported instead, and the saved inventory
 * stays the last one actually taken.
 */
export const refreshOnBotJoin =
  (
    deps: BotJoinedChannelDeps,
  ): ((adapter: Adapter, channelId: string) => Promise<void>) =>
  async (adapter, channelId) => {
    let installationId: string;
    try {
      installationId = await installationOfEvent(deps, adapter, channelId);
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
