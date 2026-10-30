// The third way an installation comes into being, and the only one that is not
// triggered by someone acting: Slack and Discord arrive through the OAuth
// callback (`routes/install-routes.ts`), and every other installation fact is
// set from a chat admin command. Mattermost can use neither -- there is no
// OAuth callback to complete, and the admin command cannot be typed because the
// bot is not connected to the server yet, which is exactly what this
// declaration provides (design.md's installation-entry table).
//
// So it runs at startup, before connections are reconciled: an installation row
// is what `ConnectionManager` counts when it decides which Mattermost servers
// to dial.
import type { InstallationStore } from '../platform/index.js';
import type { MattermostInstallationConfig } from './config.js';

/** One declaration that could not be stored, and why. */
export interface MattermostInstallationFailure {
  readonly workspaceId: string;
  readonly error: unknown;
}

export interface EnsureMattermostInstallationsDeps {
  readonly store: Pick<InstallationStore, 'save'>;
  /**
   * The declarations to ensure, passed in rather than read here: this module
   * performs the work, `config.ts` decides what the work is
   * (`.claude/rules/coding-style.md`, "executors take their work-set as
   * input").
   */
  readonly declared: ReadonlyArray<MattermostInstallationConfig>;
  /**
   * Required, not optional, for the reason `InstallationStoreDeps`'s own
   * failure hook is: this app has no logger, so a report can only travel
   * outward as a function the caller supplies, and leaving it out would turn a
   * server that never came up into silence at startup.
   */
  readonly onFailed: (failure: MattermostInstallationFailure) => void;
}

/**
 * Ensures every declared Mattermost installation exists, and answers the ids of
 * the ones that do.
 *
 * `InstallationStore.save` is an upsert, so a restart re-declares rather than
 * duplicates, and a token rotated in the configuration takes effect on the next
 * start.
 *
 * **One failure does not stop the rest, and none of them stops startup.** The
 * HTTP endpoints are always served regardless of which chat services are
 * reachable (tasks.md 9.1), and a Mattermost server that is down at this
 * moment is reached on a later reconcile cycle rather than never.
 */
export const ensureMattermostInstallations = async (
  deps: EnsureMattermostInstallationsDeps,
): Promise<ReadonlyArray<string>> => {
  const results = await Promise.all(
    deps.declared.map(async (installation) => {
      try {
        return await deps.store.save(
          'mattermost',
          installation.workspaceId,
          installation.workspaceName,
          {
            mattermost: {
              baseUrl: installation.baseUrl,
              botToken: installation.botToken,
            },
          },
        );
      } catch (error) {
        // Reported by workspace, never by repeating the declaration: one of its
        // fields is a bot token.
        deps.onFailed({ workspaceId: installation.workspaceId, error });
        return null;
      }
    }),
  );

  return results.filter((id): id is string => id != null);
};
