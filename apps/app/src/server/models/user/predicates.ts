import { UserStatus } from './conts';

/**
 * Whether a user may operate GROWI at all.
 *
 * This is the single definition of the gate `middlewares/login-required.ts`
 * applies to every screen-driven request: only an ACTIVE user is let
 * through. It is deliberately written as "is ACTIVE" and not "is not one of
 * the inactive statuses" (`INACTIVE_USER_STATUSES`) so that an absent or
 * unknown status fails closed instead of reading as "may operate".
 *
 * Callers that reach GROWI from outside the screens -- the chat integration
 * resolves an actor from a chat account, with no middleware in front of it --
 * must share this predicate rather than re-deriving the comparison, because
 * a divergence would let a suspended or deleted person act from chat while
 * being unable to do anything in the UI.
 */
export const isActiveUserStatus = (status: unknown): boolean =>
  status === UserStatus.STATUS_ACTIVE;

/**
 * Whether writes must be refused for this user.
 *
 * Single definition of the gate `middlewares/exclude-read-only-user.ts`
 * applies. Truthiness (not `=== true`) is intentional: it keeps this
 * provably identical to the condition the middleware has always used.
 */
export const isReadOnlyUser = (
  user: { readOnly?: boolean | null } | null | undefined,
): boolean => Boolean(user?.readOnly);
