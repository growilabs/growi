import { ErrorV3 } from '@growi/core/dist/models';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type {
  IResPasswordHashCleanup,
  IResPasswordHashMigrationStatus,
} from '~/interfaces/password-hash-migration';
import type Crowi from '~/server/crowi';
import { runPasswordHashCleanup } from '~/server/service/password-hash-cleanup';
import { countPasswordHashFormatDistribution } from '~/server/service/password-hash-format-distribution';
import { listPasswordHashUnmigratedUsers } from '~/server/service/password-hash-unmigrated-users';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:security-setting:password-hash',
);

/**
 * Admin-facing surface for the SHA-256 -> scrypt password-hash migration.
 *
 * WHY this exists alongside the CLI script: the cleanup decides when a GROWI
 * instance stops being able to downgrade, so the person who owns that decision is
 * the GROWI administrator. In managed hosting that administrator has no shell into
 * the container, which left the migration impossible to finish — the legacy hashes
 * would sit in the database forever. Exposing it here puts execution in the hands
 * of the actor who owns the decision.
 *
 * DELIBERATELY NOT EXPOSED HERE: the downgrade-prep and re-upgrade-prep scripts.
 * Those are inseparable from the act of deploying a different version, so the
 * actor is whoever performs the rollback, not the tenant's administrator. Putting
 * them behind an admin button would split responsibility from capability — and
 * re-upgrade-prep in particular has to run before the new build accepts logins, a
 * window only the deployer controls. Keep them CLI-only.
 */

const usersCollection = () => mongoose.connection.collection('users');
const externalAccountsCollection = () =>
  mongoose.connection.collection('externalaccounts');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePositiveInt = (raw: unknown, fallback: number): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/**
 * GET the format distribution so the admin can see whether the cleanup is runnable.
 * Read-only: it never modifies a document.
 */
export const handleGetPasswordHashMigrationStatus = async (
  _req: CrowiRequest,
  res: ApiV3Response,
): Promise<void> => {
  try {
    const distribution = await countPasswordHashFormatDistribution(
      usersCollection(),
    );

    const status: IResPasswordHashMigrationStatus = {
      distribution,
      // Mirrors the cleanup's own abort condition: only ACTIVE not-yet-migrated
      // users block it. Sending it explicitly keeps the UI from re-deriving (and
      // drifting from) the rule the server actually enforces.
      isCleanupRunnable: distribution.legacyOnlyActive === 0,
      // Completion means no old-format credential is left ANYWHERE, which is not
      // the same as "nothing for the cleanup to remove". A `legacyOnly` user holds
      // old-format data too — the cleanup simply cannot touch it, because it is
      // that user's only credential. Deriving this from `both` alone would report
      // an instance where nobody has migrated yet as already hardened.
      isCleanupCompleted:
        distribution.both === 0 && distribution.legacyOnly === 0,
    };

    res.apiv3(status);
  } catch (err) {
    logger.error(err);
    res.apiv3Err(
      new ErrorV3(
        'Failed to read the password-hash migration status',
        'password-hash-migration-status-failed',
      ),
    );
  }
};

/**
 * Run the cleanup: remove the legacy SHA-256 `password` field from fully-migrated
 * users. Destructive and irreversible — after this the instance can no longer be
 * downgraded without sending every migrated user a password-reset mail.
 *
 * The blocking condition is re-checked inside `runPasswordHashCleanup`, so a
 * client that ignores `isCleanupRunnable` still cannot force the removal.
 */
export const handlePasswordHashCleanup = (crowi: Crowi) => {
  const activityEvent = crowi.events.activity;

  return async (_req: CrowiRequest, res: ApiV3Response): Promise<void> => {
    try {
      const result = await runPasswordHashCleanup(usersCollection());

      if (result.aborted) {
        res.apiv3Err(
          new ErrorV3(
            `Cleanup aborted: ${result.legacyOnly} active user(s) have not migrated yet`,
            'password-hash-cleanup-blocked',
            undefined,
            { legacyOnlyActive: result.legacyOnly },
          ),
          409,
        );
        return;
      }

      const parameters = {
        action: SupportedAction.ACTION_ADMIN_PASSWORD_HASH_CLEANUP,
      };
      // Emit before the response — see rules/activity-recording.md.
      activityEvent.emit('update', res.locals.activity._id, parameters);

      const body: IResPasswordHashCleanup = { unset: result.unset };
      res.apiv3(body);
    } catch (err) {
      logger.error(err);
      res.apiv3Err(
        new ErrorV3(
          'Failed to run the password-hash cleanup',
          'password-hash-cleanup-failed',
        ),
      );
    }
  };
};

/**
 * List the users who still hold an old-format credential.
 *
 * Separate from the status endpoint because it is paged and much heavier: the
 * status is read on every render of the section, this only when the administrator
 * actually wants to see who is left.
 */
export const handleGetPasswordHashUnmigratedUsers = async (
  req: CrowiRequest,
  res: ApiV3Response,
): Promise<void> => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    // Clamp rather than reject: an out-of-range limit is a caller mistake worth
    // absorbing, not worth failing an administrator's page load over.
    const limit = Math.min(
      parsePositiveInt(req.query.limit, DEFAULT_LIMIT),
      MAX_LIMIT,
    );

    const result = await listPasswordHashUnmigratedUsers(
      usersCollection(),
      externalAccountsCollection(),
      { page, limit },
    );

    res.apiv3(result);
  } catch (err) {
    logger.error(err);
    res.apiv3Err(
      new ErrorV3(
        'Failed to list the users that have not migrated yet',
        'password-hash-unmigrated-users-failed',
      ),
    );
  }
};
