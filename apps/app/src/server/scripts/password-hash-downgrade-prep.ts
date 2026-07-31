import { resolve } from 'node:path';
import { format } from 'date-fns/format';
import { subSeconds } from 'date-fns/subSeconds';
import type { Collection, Document, Filter, WithId } from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import Crowi from '../crowi';
import PasswordResetOrder from '../models/password-reset-order';
import {
  scopeFilter,
  upgradedOnlyFilter,
} from '../models/user/password-hash-format-filters';
import { configManager } from '../service/config-manager';
import { growiInfoService } from '../service/growi-info';
import { getMongoUri, mongoOptions } from '../util/mongoose-utils';
import { resolveLocalePath } from '../util/safe-path-utils';

const logger = loggerFactory('growi:scripts:password-hash-downgrade-prep');

export interface DowngradePrepResult {
  /** number of users who would be locked out after a downgrade
   *  (`passwordHash` set, `password` unset). */
  upgradedOnly: number;
  /** number of reset emails successfully sent. */
  sent: number;
  /** number of reset emails that failed to send (passwordHash left intact). */
  failed: number;
  /** number of documents from which `passwordHash` was $unset. */
  unset: number;
}

export interface DowngradePrepDeps {
  usersCollection: Collection;
  /**
   * Create the PasswordResetOrder + send the reset email for a single user.
   * MUST reject/throw on send failure; the core only $unsets passwordHash after
   * this resolves.
   */
  sendResetEmailForUser: (user: WithId<Document>) => Promise<void>;
  /** true → send emails and $unset passwordHash; false → report-only (Req 4.1). */
  sendResetEmails: boolean;
  /**
   * Optional scope AND-combined with the upgradedOnly classification; defaults
   * to `{}` (whole collection) so `main()` and production behavior are unchanged.
   * A caller (integ test) may pass a marker scope to confine the count/find/write
   * to a marker-seeded subset of the shared `users` collection.
   */
  baseFilter?: Filter<Document>;
}

/**
 * Prepare for a downgrade to the legacy SHA-256-only build by making sure no
 * user is left with a scrypt-only credential (`passwordHash` set, `password`
 * unset) that the old build cannot verify — such users would be locked out.
 *
 * WHY a standalone script (not a migrate-mongo migration): sending reset emails
 * needs `mailService`, which only exists after a full Crowi bootstrap — not
 * available in the migrate-mongo container.
 *
 * Run manually by an admin:
 *   - development: `pnpm run password-hash:downgrade-prep:dev`
 *     (= `pnpm run tsrun src/server/scripts/password-hash-downgrade-prep.ts`)
 *   - production (Docker, built output): `pnpm run password-hash:downgrade-prep`
 *     (= `node dist/server/scripts/password-hash-downgrade-prep.js`)
 *   Set `SEND_RESET_EMAILS=true` to actually send emails and unset passwordHash
 *   (default is a report-only run).
 *
 * This function is the pure core: it takes the `users` collection and a
 * `sendResetEmailForUser` collaborator as input and returns a structured tally.
 * It never bootstraps Crowi, never touches SMTP directly, and never calls
 * process.exit — so it is unit-testable with test doubles.
 *
 * Steps:
 *  1. Count `upgradedOnly` users and log it (Req 4.1).
 *  2. If `sendResetEmails` is false → STOP after logging, making NO DB change
 *     (report-only default, Req 4.1).
 *  3. Otherwise, for each `upgradedOnly` user (Req 4.2, 4.3):
 *     - call `sendResetEmailForUser`;
 *     - ONLY after the send SUCCEEDS, `$unset` that user's `passwordHash`;
 *     - if the send FAILS, leave `passwordHash` intact so a re-run retries it;
 *     - tally success / failure.
 *
 * CRITICAL: `passwordHash` is removed with `$unset` (never set to `null` or '').
 * The shared classification filters now treat null/'' as absent, so a nulled
 * user would classify as `noPassword` rather than `upgradedOnly` — but relying on
 * that would still cause a double-sent reset email on the next run (the user
 * would re-enter neither the upgradedOnly nor a clean state predictably). `$unset`
 * cleanly moves the user to `noPassword`, as required.
 */
export async function runDowngradePrep(
  deps: DowngradePrepDeps,
): Promise<DowngradePrepResult> {
  const {
    usersCollection,
    sendResetEmailForUser,
    sendResetEmails,
    baseFilter = {},
  } = deps;

  const scopedUpgradedOnlyFilter = scopeFilter(baseFilter, upgradedOnlyFilter);

  const upgradedOnly = await usersCollection.countDocuments(
    scopedUpgradedOnlyFilter,
  );

  logger.info(
    `${upgradedOnly} user(s) have a scrypt-only credential (passwordHash set, no legacy password) and would be locked out after a downgrade.`,
  );

  if (!sendResetEmails) {
    logger.info(
      'SEND_RESET_EMAILS is not "true": report-only run, no reset emails sent and no documents modified. Re-run with SEND_RESET_EMAILS=true to send reset emails and unset passwordHash.',
    );
    return { upgradedOnly, sent: 0, failed: 0, unset: 0 };
  }

  let sent = 0;
  let failed = 0;
  let unset = 0;

  const cursor = usersCollection.find(scopedUpgradedOnlyFilter);
  for await (const user of cursor) {
    try {
      // Sequential by design: send one reset email at a time (avoid hammering
      // the SMTP server) and only unset after each individual send succeeds.
      await sendResetEmailForUser(user);
      sent += 1;

      // Send succeeded → remove the scrypt credential so the user must reset
      // after the downgrade. $unset (field removal), NEVER null — see the
      // CRITICAL note above.
      const updateResult = await usersCollection.updateOne(
        { _id: user._id },
        { $unset: { passwordHash: '' } },
      );
      unset += updateResult.modifiedCount;
    } catch (err) {
      failed += 1;
      logger.warn(
        { err, userId: String(user._id), username: user.username },
        'Failed to send password-reset email; leaving passwordHash intact for retry on the next run.',
      );
    }
  }

  logger.info(
    `Downgrade prep complete: sent ${sent} reset email(s) and unset passwordHash on ${unset} user(s).`,
  );
  if (failed > 0) {
    logger.warn(
      `${failed} reset email(s) failed to send; those users keep their passwordHash. Re-run the script to retry them.`,
    );
  }

  return { upgradedOnly, sent, failed, unset };
}

// ─── Thin CLI wrapper (only runs when executed as the entry point) ───────────

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return (
    entry != null && resolve(entry) === resolve(import.meta.filename ?? '')
  );
};

/**
 * Build the real `sendResetEmailForUser` from the app's PasswordResetOrder model
 * and Crowi's mailService, mirroring the forgot-password route's email flow.
 * Rejects (throws) on send failure, so the core leaves passwordHash intact.
 */
const createRealSender = (crowi: Crowi) => {
  const { appService, mailService } = crowi;
  const locale = configManager.getConfig('app:globalLang');
  const appUrl = growiInfoService.getSiteUrl();

  return async (user: WithId<Document>): Promise<void> => {
    const email = user.email as string | undefined;
    if (email == null) {
      throw new Error(`user ${String(user._id)} has no email address`);
    }

    const order = await PasswordResetOrder.createPasswordResetOrder(email);
    const oneTimeUrl = new URL(`/forgot-password/${order.token}`, appUrl).href;
    const grwTzoffsetSec = appService.getTzoffset() * 60;
    const expiredAt = format(
      subSeconds(order.expiredAt, grwTzoffsetSec),
      'yyyy/MM/dd HH:mm',
    );
    const templatePath = resolveLocalePath(
      locale,
      crowi.localeDir,
      'notifications/passwordReset.ejs',
    );

    await mailService.send({
      to: email,
      subject: '[GROWI] Password Reset',
      template: templatePath,
      vars: {
        appTitle: appService.getAppTitle(),
        email,
        url: oneTimeUrl,
        expiredAt,
      },
    });
  };
};

export async function main(): Promise<void> {
  await mongoose.connect(getMongoUri(), mongoOptions);
  const crowi = new Crowi();
  await crowi.init();
  try {
    const result = await runDowngradePrep({
      usersCollection: mongoose.connection.collection('users'),
      sendResetEmailForUser: createRealSender(crowi),
      sendResetEmails: process.env.SEND_RESET_EMAILS === 'true',
    });
    logger.info({ result }, 'Downgrade prep result');
  } finally {
    await mongoose.disconnect();
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    logger.error('password-hash downgrade-prep script failed:', err);
    process.exitCode = 1;
  });
}
