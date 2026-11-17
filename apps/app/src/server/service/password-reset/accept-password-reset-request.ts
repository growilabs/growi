export interface AcceptPasswordResetRequestDeps {
  /** Whether the email belongs to an account that may reset its password. */
  readonly isResettableAccount: (email: string) => Promise<boolean>;
  /** Create the reset order and deliver the reset mail. */
  readonly sendPasswordResetMail: (email: string) => Promise<void>;
  readonly onMailSent: () => void;
  readonly onMailFailed: (err: unknown) => void;
}

/**
 * Accept a password reset request without waiting for the mail delivery.
 *
 * The returned promise settles as soon as the account lookup is done, for
 * both resettable and unknown/inactive accounts, so the response time does not
 * reveal whether the email is registered. Mail delivery continues in the
 * background and reports its outcome through `onMailSent` / `onMailFailed`.
 */
export const acceptPasswordResetRequest = async (
  email: string,
  deps: AcceptPasswordResetRequestDeps,
): Promise<void> => {
  if (!(await deps.isResettableAccount(email))) {
    return;
  }

  const deliver = async (): Promise<void> => {
    try {
      await deps.sendPasswordResetMail(email);
    } catch (err) {
      deps.onMailFailed(err);
      return;
    }
    deps.onMailSent();
  };

  // Intentionally not awaited: the caller must not observe delivery latency.
  deliver().catch(deps.onMailFailed);
};
