/**
 * Pure judgement for whether a G2G transfer should proceed.
 *
 * Everything here is a pure function: it takes the source and destination state as
 * plain data and returns what to do about it, so it can be unit-tested without a
 * database, a socket, or a second GROWI process (requirements 3.4, 3.5, 3.7, 6.3).
 * Fetching that state (counts, config, a password-seed fingerprint) is the caller's
 * job — `G2GTransferPusherService.getTransferability` for the existing blockers today,
 * and the preflight route (task 8.2) for the full report including warnings.
 */

/**
 * A reason the transfer must not proceed at all. These are the pre-existing
 * compatibility checks, relocated from `G2GTransferPusherService.getTransferability`
 * without changing which conditions block a transfer or what the operator is told.
 */
export type TransferBlocker =
  | {
      readonly type: 'version_mismatch';
      readonly src: string;
      readonly dest: string;
    }
  | {
      readonly type: 'user_upper_limit';
      readonly activeUsers: number;
      readonly limit: number;
    }
  | {
      readonly type: 'file_upload_not_configured';
      readonly side: 'src' | 'dest';
    }
  | { readonly type: 'destination_storage_not_writable' }
  | {
      readonly type: 'file_upload_total_limit';
      readonly required: number;
      readonly limit: number;
    };

/**
 * A condition the operator must acknowledge before the transfer proceeds. Unlike a
 * {@link TransferBlocker}, none of these stop the transfer by themselves.
 */
export type TransferWarning =
  | { readonly type: 'password_seed_mismatch' }
  /** The destination has no administrator who can currently log in (count === 0). */
  | { readonly type: 'no_loginable_admin' }
  | { readonly type: 'sessions_not_invalidatable' }
  /** The source has local (username/password) authentication disabled, so even a
   *  rescued destination administrator cannot use a password to log in — the
   *  destination's `configs` collection is always replaced with the source's. */
  | { readonly type: 'local_auth_disabled_at_source' };

export interface TransferabilityReport {
  readonly blockers: readonly TransferBlocker[];
  readonly warnings: readonly TransferWarning[];
}

/**
 * Everything `evaluateBlockers` needs to know about the source GROWI. Field-for-field
 * match with `G2GTransferPusherService.getTransferability`'s existing inputs — every
 * one of them is already available there today, with no dependency on tasks 8.1/8.2.
 */
export interface TransferabilityBlockerSource {
  readonly version: string;
  readonly activeUsers: number;
  readonly totalFileSize: number;
  readonly fileUploadType: string;
}

/**
 * The two extra facts the warnings need about the source, on top of
 * {@link TransferabilityBlockerSource}. Neither is available at the one call site that
 * exists today (`getTransferability`, which only ever needs blockers) — computing them
 * for real is task 8.2's job, once the preflight endpoint exists to show the resulting
 * warnings.
 */
export interface TransferabilitySource extends TransferabilityBlockerSource {
  /** One-way hash of `PASSWORD_SEED`; the seed itself is never part of this shape. */
  readonly passwordSeedFingerprint: string;
  readonly isLocalAuthEnabled: boolean;
}

/**
 * Everything `evaluateBlockers` needs to know about the destination GROWI.
 * Field-for-field match with `IDataGROWIInfo` (`server/service/g2g-transfer.ts`) as it
 * exists today.
 */
export interface TransferabilityBlockerDestination {
  readonly version: string;
  readonly userUpperLimit: number | null;
  readonly fileUploadTotalLimit: number | null;
  readonly attachmentInfo: {
    readonly type: string;
    readonly writable: boolean;
  };
}

/**
 * The three extra facts the warnings need about the destination, on top of
 * {@link TransferabilityBlockerDestination}.
 *
 * Deliberately not folded into `IDataGROWIInfo` itself: `IDataGROWIInfo` does not yet
 * carry these — populating them from the destination's own report is task 8.1's job.
 * Once that lands, `IDataGROWIInfo` becomes a superset of `TransferabilityDestination`
 * and can be passed to `evaluateTransferability` directly; until then, no caller can
 * construct one without task 8.1/8.2's real data, which is the point: there is no
 * placeholder value for "nobody has checked whether the destination has a loginable
 * admin yet" that means the same thing as `loginableAdminCount > 0`, so this type
 * cannot be satisfied by guessing.
 */
export interface TransferabilityDestination
  extends TransferabilityBlockerDestination {
  readonly passwordSeedFingerprint: string;
  /** Administrators that both have a password and are in an active status. */
  readonly loginableAdminCount: number;
  readonly sessionStoreSupportsEnumeration: boolean;
}

/**
 * Builds the operator-facing message for a blocker. The single place that turns a
 * {@link TransferBlocker} into text, so the wording lives in one spot instead of being
 * re-typed at every call site.
 *
 * Kept byte-identical to the messages `G2GTransferPusherService.getTransferability`
 * used to build inline, for every condition that could actually fire. The one
 * exception is the `dest` side of `file_upload_not_configured`: the original code had
 * two separate checks for it (`destGROWIInfo.fileUploadDisabled` and
 * `destGROWIInfo.attachmentInfo.type === 'none'`), both derived from the same
 * `app:fileUploadType` config read on the destination, so they were always true or
 * false together — the first of the two always fired and the second could never be
 * reached. This function keeps the message from the one that could actually fire.
 */
export function describeBlocker(blocker: TransferBlocker): string {
  switch (blocker.type) {
    case 'version_mismatch':
      return `GROWI versions mismatch. src GROWI: ${blocker.src} / dest GROWI: ${blocker.dest}.`;
    case 'user_upper_limit':
      return `The number of active users (${blocker.activeUsers} users) exceeds the limit of the destination GROWI (up to ${blocker.limit} users).`;
    case 'file_upload_not_configured':
      return blocker.side === 'dest'
        ? 'The file upload setting is disabled in the destination GROWI.'
        : 'File upload is not configured for src GROWI.';
    case 'destination_storage_not_writable':
      return 'The storage of the destination GROWI is not writable.';
    case 'file_upload_total_limit':
      return `The total file size of attachments exceeds the file upload limit of the destination GROWI. Requires ${blocker.required.toLocaleString()} bytes, but got ${blocker.limit.toLocaleString()} bytes.`;
    default: {
      // Exhaustiveness check: a new TransferBlocker variant fails the build here until
      // this switch is taught how to describe it.
      const exhaustiveCheck: never = blocker;
      throw new Error(
        `Unknown TransferBlocker: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

/**
 * Computes the reasons a transfer must not proceed at all. Pure, and used internally by
 * {@link evaluateTransferability} below — `G2GTransferPusherService.getTransferability`
 * and `preflight` both go through `evaluateAgainstDestination`, which always runs the
 * full `evaluateTransferability`, so there is no current caller that reaches this
 * function without going through that one.
 *
 * Kept as its own exported function, rather than inlined into
 * {@link evaluateTransferability}, specifically so a caller that only has blocker
 * inputs in hand is never tempted to invent values for the warning-only ones just to
 * call the combined function — there is no such thing as a neutral placeholder for
 * "the destination's loginable admin count is unknown" that cannot be misread as "the
 * destination has one" (see the doc comment on {@link TransferabilityDestination}). The
 * same property is why it is unit-tested on its own
 * (`g2g-transfer-transferability.spec.ts`), independent of the warning fixtures
 * {@link evaluateTransferability}'s tests need.
 */
export function evaluateBlockers(
  src: TransferabilityBlockerSource,
  dest: TransferabilityBlockerDestination,
): readonly TransferBlocker[] {
  const blockers: TransferBlocker[] = [];

  if (src.version !== dest.version) {
    blockers.push({
      type: 'version_mismatch',
      src: src.version,
      dest: dest.version,
    });
  }

  const { userUpperLimit } = dest;
  if (userUpperLimit != null && userUpperLimit < src.activeUsers) {
    blockers.push({
      type: 'user_upper_limit',
      activeUsers: src.activeUsers,
      limit: userUpperLimit,
    });
  }

  if (dest.attachmentInfo.type === 'none') {
    blockers.push({ type: 'file_upload_not_configured', side: 'dest' });
  }

  if (src.fileUploadType === 'none') {
    blockers.push({ type: 'file_upload_not_configured', side: 'src' });
  }

  if (!dest.attachmentInfo.writable) {
    blockers.push({ type: 'destination_storage_not_writable' });
  }

  const { fileUploadTotalLimit } = dest;
  if (
    fileUploadTotalLimit != null &&
    fileUploadTotalLimit < src.totalFileSize
  ) {
    blockers.push({
      type: 'file_upload_total_limit',
      required: src.totalFileSize,
      limit: fileUploadTotalLimit,
    });
  }

  return blockers;
}

/**
 * Judges whether a transfer should proceed, and what the operator should be warned
 * about first. Pure: every input is a plain value already fetched by the caller.
 *
 * Blockers and warnings are independent facts about the same transfer — a blocker
 * being present never suppresses a warning computed alongside it, and every applicable
 * blocker/warning is reported, not just the first (a caller that only wants "the one
 * reason" picks `report.blockers[0]`, as `G2GTransferPusherService.getTransferability`
 * does via `toTransferability`).
 */
export function evaluateTransferability(
  src: TransferabilitySource,
  dest: TransferabilityDestination,
): TransferabilityReport {
  const blockers = evaluateBlockers(src, dest);

  const warnings: TransferWarning[] = [];

  if (src.passwordSeedFingerprint !== dest.passwordSeedFingerprint) {
    warnings.push({ type: 'password_seed_mismatch' });
  }

  // `=== 0`, not "fewer than N": a destination with 5 administrators where 4 happen to
  // be suspended still has one that can log in, and must not be warned about (the
  // count itself already answers "can anyone log in", it is not a headcount to
  // threshold against).
  if (dest.loginableAdminCount === 0) {
    warnings.push({ type: 'no_loginable_admin' });
  }

  if (!dest.sessionStoreSupportsEnumeration) {
    warnings.push({ type: 'sessions_not_invalidatable' });
  }

  if (!src.isLocalAuthEnabled) {
    warnings.push({ type: 'local_auth_disabled_at_source' });
  }

  return { blockers, warnings };
}
