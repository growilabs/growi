import { loggerFactory } from '@growi/logger';

import { VaultUserViewModel } from '../models/vault-user-view.js';
import { deleteNamespace } from './vault-repo-storage.js';

const logger = loggerFactory('growi:vault-manager:vault-legacy-anonymous-view');

const LEGACY_ANONYMOUS_NAMESPACE = 'anonymous-view';

/**
 * Removes the `anonymous-view` ref, HEAD and `vault_user_views` record that an
 * earlier version created for credential-less clones. Runs on every startup
 * and never throws: a failure is logged and the next startup tries again
 * (see design.md, 起動時の片付け).
 */
export async function removeLegacyAnonymousView(): Promise<void> {
  try {
    await deleteNamespace(LEGACY_ANONYMOUS_NAMESPACE);
    // Matches only the record stored with `userId: null`; a bare `userId: null`
    // filter would also match a document that lacks the field.
    await VaultUserViewModel.deleteMany({ userId: { $type: 'null' } });
  } catch (err) {
    logger.error(
      { err },
      'vault-legacy-anonymous-view: failed to remove the legacy anonymous-view; the next startup retries',
    );
  }
}
