import {
  DeadlineExceededError,
  runWithDeadline,
  waitUntil,
} from '~/server/util/deadline';

export type PasswordResetRequestOutcome = 'accepted' | 'failed';

export interface ProcessPasswordResetRequestDeps {
  /** Whether the email belongs to an account that may reset its password. */
  readonly isResettableAccount: (email: string) => Promise<boolean>;
  /** Create the reset order and deliver the reset mail. */
  readonly sendPasswordResetMail: (email: string) => Promise<void>;
  /** Called when the reset mail has been delivered before the deadline. */
  readonly onMailSent: () => void;
  /** Called as soon as an error occurs (also after the deadline). */
  readonly onError: (err: unknown) => void;
  /** Called at the deadline when processing has not finished by then. */
  readonly onDeadlineExceeded: () => void;
}

const handle = async (
  email: string,
  deps: ProcessPasswordResetRequestDeps,
  respondAt: number,
): Promise<PasswordResetRequestOutcome> => {
  let sendTask: Promise<void> | undefined;
  try {
    const isResettable = await runWithDeadline(
      deps.isResettableAccount(email),
      respondAt,
    );
    if (!isResettable) {
      // No callback here on purpose: an unknown or inactive account must not
      // leave any trace that differs from a successful delivery.
      return 'accepted';
    }

    sendTask = deps.sendPasswordResetMail(email);
    await runWithDeadline(sendTask, respondAt);
    deps.onMailSent();
    return 'accepted';
  } catch (err) {
    if (!(err instanceof DeadlineExceededError)) {
      deps.onError(err);
      return 'failed';
    }
    deps.onDeadlineExceeded();
    // Delivery is not cancelled. Only a late failure is reported: the request
    // has already been answered as failed, so a late success must not record
    // anything (e.g. an activity emitted after the response is sent).
    sendTask?.catch(deps.onError);
    return 'failed';
  }
};

/**
 * Process a password reset request and settle exactly at `respondAt`
 * (epoch ms), whatever the outcome.
 *
 * Settling at a fixed time keeps the response time identical for registered,
 * unknown and inactive emails, so it does not reveal account existence.
 * Unknown and inactive accounts are reported as 'accepted'; only errors and
 * unfinished deliveries are reported as 'failed'. The `on*` callbacks are
 * invoked when each event happens, not at `respondAt`.
 */
export const processPasswordResetRequest = async (
  email: string,
  deps: ProcessPasswordResetRequestDeps,
  respondAt: number,
): Promise<PasswordResetRequestOutcome> => {
  const outcome = await handle(email, deps, respondAt);
  await waitUntil(respondAt);
  return outcome;
};
