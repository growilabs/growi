// Speaking as one installation's bot when no incoming event says which.
//
// A service whose one adapter serves many workspaces (Slack in multi-workspace
// socket mode) picks the bot token from the event it is handling. Everything
// this proxy sends while handling an event -- a reply, a placeholder later
// replaced -- inherits that choice. A post this proxy starts on its own (a GROWI
// notification) has no event behind it, so the installation it is for has to
// be named, and its credentials read from this proxy's own store.
//
// Whether a service needs this at all is declared on its `ADAPTER_FACTORIES`
// entry (`bindInstallation`), never decided here by its name.
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';

import type { AdapterFactory } from './adapter-set.js';
import type { InstallationProvider } from './installation-provider.js';

/** Runs `work` -- every SDK call it makes -- as one installation's bot. */
export type ScopedRun = <T>(work: () => Promise<T>) => Promise<T>;

export interface InstallationScopeDeps {
  readonly installations: InstallationProvider;
  readonly factories: Readonly<Record<PlatformName, AdapterFactory>>;
}

/**
 * How an outbound call on `platform` through `adapter` speaks as installation
 * `installationId`, or `null` when the adapter already knows whose bot it is
 * (one app-wide token, or an adapter opened for that installation alone).
 *
 * The credentials are read when the returned function runs, not here, so a
 * failure to read them surfaces inside the outbound call's own error handling
 * -- which turns it into a `PostOutcome` rather than an exception.
 */
export const installationRunner = (
  platform: PlatformName,
  adapter: Adapter,
  installationId: string,
  deps: InstallationScopeDeps,
): ScopedRun | null => {
  const factory = deps.factories[platform];
  if (factory.credentialSource !== 'app' || factory.bindInstallation == null) {
    return null;
  }
  const bind = factory.bindInstallation;

  return async (work) => {
    // Looked up among this service's installations only, so a scope naming
    // another service's installation cannot lend its credentials here.
    const listed = await deps.installations.list(platform);
    const found = listed.find(
      (installation) => installation.installationId === installationId,
    );
    if (found == null) {
      throw new Error(
        `installation ${installationId} is not a ${platform} installation this proxy holds`,
      );
    }
    const credentials = await deps.installations.resolve(
      platform,
      found.workspaceId,
    );
    if (credentials == null) {
      throw new Error(
        `installation ${installationId} carries no ${platform} credentials`,
      );
    }
    return await bind(
      adapter,
      { workspaceId: found.workspaceId, credentials },
      work,
    );
  };
};
