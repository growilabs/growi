// Thin pass-through over `db/`'s `InstallationRepository`, addressed by
// workspace rather than by row id -- the vocabulary `resolve`/`list`'s two
// callers (command handlers resolving credentials, and `ConnectionManager`
// enumerating what a connection serves) both use.
//
// This file adds no logic beyond delegation: `InstallationRepository`
// (task 2.1) already decrypts `resolveCredentials()`'s result and already
// shapes `listByPlatform()`'s return value identically to what
// `InstallationProvider.list()` declares below, so there is nothing here to
// transform. What this file DOES own is the layer boundary -- `platform/`
// reaches `db/` only through its declared barrel (`db/index.js`), never by
// importing `db/repositories/installation-repository.ts` directly
// (architecture.spec.ts's "db barrel-only" guard).
//
// `ConnectionManager` (task 3.8) is this type's only planned consumer of
// `list()`, and it combines the result with `CONNECTION_UNIT_TABLE`
// (task 1.6) to decide how many connections a platform actually needs --
// installation count alone does not answer that (design.md: 「あるべき接続
// の本数」は installation の数では決まらない). Deciding that is
// `ConnectionManager`'s job, not this one's.
import type { PlatformName } from '@growi/chat';

import type { InstallationRepository } from '../db/index.js';
import type { InstallationCredentials } from '../types/index.js';

export interface InstallationProvider {
  resolve(
    platform: PlatformName,
    workspaceId: string,
  ): Promise<InstallationCredentials | null>;
  /** The installations a connection for `platform` is responsible for. */
  list(
    platform: PlatformName,
  ): Promise<ReadonlyArray<{ installationId: string; workspaceId: string }>>;
}

export const createInstallationProvider = (
  repository: InstallationRepository,
): InstallationProvider => ({
  resolve: (platform, workspaceId) =>
    repository.resolveCredentials(platform, workspaceId),
  list: (platform) => repository.listByPlatform(platform),
});
