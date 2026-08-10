import type { Collection, Document, Filter, WithId } from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import Crowi from '../crowi';
import {
  activeUserFilter,
  nonActiveUserFilter,
  scopeFilter,
  upgradedOnlyFilter,
} from '../models/user/password-hash-format-filters';
import { createAndSendPasswordResetOrder } from '../service/password-reset';
import {
  exitAfterLogFlush,
  isEntryPoint,
  withMongoConnection,
} from './script-runner';

const logger = loggerFactory('growi:scripts:password-hash-downgrade-prep');

/**
 * Above this many recipients, the run is long enough that the users mailed first
 * will very likely see their ~10-minute reset link expire before they open it —
 * worth an explicit heads-up rather than a silent slow loop.
 */
const LARGE_BATCH_WARN_THRESHOLD = 50;

export interface DowngradePrepResult {
  /**
   * true when send mode refused to run because the password-reset path is
   * unavailable — NO email was sent and NO document was modified.
   */
  aborted: boolean;
  /** number of ACTIVE users who would be locked out after a downgrade
   *  (`passwordHash` set, `password` unset) — the actionable set: only an ACTIVE
   *  user can be recovered by a reset email. */
  upgradedOnly: number;
  /**
   * number of NON-ACTIVE users in the same credential state (invited /
   * registered / suspended / deleted). They are counted and warned about but
   * never emailed and never `$unset`: `/forgot-password` rejects non-active
   * users on both POST and PUT, so removing their `passwordHash` would leave
   * them with no credential AND no recovery path (permanent lockout). An admin
   * must handle them manually (activate, then reset — or delete).
   */
  upgradedOnlyNonActive: number;
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
   * Whether the `/forgot-password` flow this script hands its users over to is
   * actually reachable — i.e. `security:passport-local:isPasswordResetEnabled`
   * AND `passportService.isLocalStrategySetup`, the exact pair
   * `checkForgotPasswordEnabledMiddlewareFactory` gates on. Computed by the
   * entrypoint from Crowi; injected so the core stays pure.
   */
  isPasswordResetAvailable: boolean;
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
 *     Always go through the npm script: it sets NODE_ENV=production and preloads
 *     `bin/runtime/env-preload.mjs` before `dist/server/scripts/…`. Invoking the
 *     built file with a bare `node` skips that preload.
 *   Set `SEND_RESET_EMAILS=true` to actually send emails and unset passwordHash
 *   (default is a report-only run).
 *
 * OPERATIONAL WARNING — the reset links expire in minutes, the send loop does not.
 * A `PasswordResetOrder` is valid for only ~10 minutes from creation (see
 * `expiredAt` in models/password-reset-order), and this script creates one per
 * user while `$unset`ting their `passwordHash` immediately. A user who opens the
 * mail after that window therefore has BOTH an expired link AND no password.
 * So: run this immediately before the downgrade, not hours ahead, and expect a
 * share of users to need a fresh `/forgot-password` request. That recovery path
 * works precisely because these users are ACTIVE and now `noPassword`, which is
 * why the reset link expiring is an inconvenience rather than a lockout — do NOT
 * "fix" it by widening PasswordResetOrder's global expiry, which would weaken the
 * whole product's reset-token window.
 *
 * This function is the pure core: it takes the `users` collection and a
 * `sendResetEmailForUser` collaborator as input and returns a structured tally.
 * It never bootstraps Crowi, never touches SMTP directly, and never calls
 * process.exit — so it is unit-testable with test doubles.
 *
 * Steps:
 *  1. Count `upgradedOnly` users, split ACTIVE vs non-active, and log both
 *     (Req 4.1).
 *  2. If `sendResetEmails` is false → STOP after logging, making NO DB change
 *     (report-only default, Req 4.1).
 *  3. Otherwise, if `isPasswordResetAvailable` is false → ABORT before any email
 *     or write: the reset links would 404 and the $unset users would have no way
 *     back in (see the guard's comment below).
 *  4. Otherwise, for each ACTIVE `upgradedOnly` user (Req 4.2, 4.3):
 *     - call `sendResetEmailForUser`;
 *     - ONLY after the send SUCCEEDS, `$unset` that user's `passwordHash`;
 *     - if the send FAILS, leave `passwordHash` intact so a re-run retries it;
 *     - tally success / failure.
 *
 * ONLY ACTIVE USERS ARE PROCESSED: `/forgot-password` rejects every non-active
 * user on both POST (request a link) and PUT (set the new password), so a reset
 * email cannot recover them. Emailing + `$unset`ting a non-active `upgradedOnly`
 * user (e.g. an invitee created by `createUserByEmail`, who is `upgradedOnly` by
 * construction) would strip their only credential and leave no recovery path at
 * all. They are counted and WARNed about instead, for manual handling.
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
    isPasswordResetAvailable,
    baseFilter = {},
  } = deps;

  // The processed set is ACTIVE-only: a reset email is the whole recovery
  // mechanism here, and only an ACTIVE user can use one.
  const scopedUpgradedOnlyFilter = scopeFilter(
    baseFilter,
    upgradedOnlyFilter,
    activeUserFilter,
  );

  const upgradedOnly = await usersCollection.countDocuments(
    scopedUpgradedOnlyFilter,
  );
  const upgradedOnlyNonActive = await usersCollection.countDocuments(
    scopeFilter(baseFilter, upgradedOnlyFilter, nonActiveUserFilter),
  );

  logger.info(
    `${upgradedOnly} active user(s) have a scrypt-only credential (passwordHash set, no legacy password) and would be locked out after a downgrade.`,
  );

  if (upgradedOnlyNonActive > 0) {
    logger.warn(
      `${upgradedOnlyNonActive} NON-ACTIVE user(s) (invited/registered/suspended/deleted) are also scrypt-only and would be locked out by a downgrade, but they are NOT processed by this script: /forgot-password rejects non-active users, so a reset email cannot recover them and unsetting their passwordHash would lock them out permanently. Handle them manually before the downgrade (e.g. activate and reset, or remove the account).`,
    );
  }

  if (!sendResetEmails) {
    logger.info(
      'SEND_RESET_EMAILS is not "true": report-only run, no reset emails sent and no documents modified. Re-run with SEND_RESET_EMAILS=true to send reset emails and unset passwordHash.',
    );
    return {
      aborted: false,
      upgradedOnly,
      upgradedOnlyNonActive,
      sent: 0,
      failed: 0,
      unset: 0,
    };
  }

  // WHY this guard: send mode strips each user's ONLY credential and hands them
  // a `/forgot-password` link as the sole way back in. That link is gated by
  // `checkForgotPasswordEnabledMiddlewareFactory`, which protects BOTH the apiv3
  // POST/PUT and the `GET /forgot-password/:token` page — so when password reset
  // is disabled (or the local strategy is not set up) every emailed link 404s and
  // the users we just $unset have neither a credential nor a recovery path,
  // recoverable only by direct DB surgery. Refuse before any email or write.
  if (!isPasswordResetAvailable) {
    logger.error(
      `Aborting downgrade prep: the password-reset path is unavailable, so the reset links this script sends would 404 and the ${upgradedOnly} active user(s) it would strip of passwordHash could not recover. No emails were sent and no documents were modified. Enable password reset (security:passport-local:isPasswordResetEnabled / LOCAL_STRATEGY_PASSWORD_RESET_ENABLED) and make sure the local strategy is set up (security:passport-local:isEnabled / LOCAL_STRATEGY_ENABLED), then re-run.`,
    );
    return {
      aborted: true,
      upgradedOnly,
      upgradedOnlyNonActive,
      sent: 0,
      failed: 0,
      unset: 0,
    };
  }

  logger.warn(
    'SEND_RESET_EMAILS=true: each reset link is valid for only ~10 minutes from the moment it is created, while passwordHash is unset immediately. Run this right before the downgrade — not hours ahead.',
  );
  if (upgradedOnly >= LARGE_BATCH_WARN_THRESHOLD) {
    logger.warn(
      `This run will email ${upgradedOnly} user(s) one at a time. The users mailed early in the run may well see their link expire before they open it — plan for a burst of /forgot-password requests, and make sure the mail transport can absorb the batch.`,
    );
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
  if (sent > 0) {
    logger.info(
      'Each reset link expires ~10 minutes after it was created. Any user who misses that window is NOT locked out: they now have no password at all, so the normal /forgot-password flow will issue them a fresh link. Tell your users that, and keep /forgot-password reachable through the downgrade.',
    );
  }

  return {
    aborted: false,
    upgradedOnly,
    upgradedOnlyNonActive,
    sent,
    failed,
    unset,
  };
}

// ─── Thin CLI wrapper (only runs when executed as the entry point) ───────────

/**
 * Build the real `sendResetEmailForUser` on top of the shared password-reset
 * mail flow — the SAME function the apiv3 forgot-password route uses, so the two
 * cannot drift apart. Rejects (throws) on send failure, so the core leaves
 * passwordHash intact.
 */
const createRealSender = (crowi: Crowi) => {
  return async (user: WithId<Document>): Promise<void> => {
    const email = user.email as string | undefined;
    if (email == null) {
      throw new Error(`user ${String(user._id)} has no email address`);
    }

    await createAndSendPasswordResetOrder(crowi, email);
  };
};

/**
 * Resolve whether `/forgot-password` is actually reachable, using the SAME pair
 * of conditions `checkForgotPasswordEnabledMiddlewareFactory` gates on, so the
 * script's precondition cannot drift from the route's gate.
 */
const resolvePasswordResetAvailability = (crowi: Crowi): boolean => {
  const isPasswordResetEnabled = crowi.configManager.getConfig(
    'security:passport-local:isPasswordResetEnabled',
  );
  return crowi.passportService.isLocalStrategySetup && isPasswordResetEnabled;
};

async function main(): Promise<void> {
  await withMongoConnection(async () => {
    const crowi = new Crowi();
    await crowi.init();
    const result = await runDowngradePrep({
      usersCollection: mongoose.connection.collection('users'),
      sendResetEmailForUser: createRealSender(crowi),
      sendResetEmails: process.env.SEND_RESET_EMAILS === 'true',
      isPasswordResetAvailable: resolvePasswordResetAvailability(crowi),
    });
    logger.info({ result }, 'Downgrade prep result');
    process.exitCode = result.aborted ? 1 : 0;
  });
}

if (isEntryPoint(import.meta.url)) {
  main()
    .catch((err) => {
      logger.error({ err }, 'password-hash downgrade-prep script failed');
      process.exitCode = 1;
    })
    // `crowi.init()` starts cron jobs, socket.io and the S2S messaging
    // subscriber; those handles keep the event loop alive forever, so the
    // process would hang here instead of ending the run. Crowi exposes no
    // teardown counterpart to init() (only `setupTerminus`, which is bound to
    // the HTTP server this script never creates), so an explicit exit is the
    // termination mechanism. Entry-point branch ONLY — `runDowngradePrep` and
    // the other exports stay side-effect-free for tests and library callers.
    .finally(() => {
      exitAfterLogFlush(
        logger,
        process.exitCode == null ? 0 : Number(process.exitCode),
      );
    });
}
