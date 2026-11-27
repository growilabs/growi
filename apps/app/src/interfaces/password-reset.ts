/**
 * Every password reset request is answered exactly this long after it was
 * received, whatever the outcome, so the response time does not reveal
 * whether the email is registered. Shared so the server's delay and the
 * client's notice about it cannot drift apart.
 */
export const PASSWORD_RESET_RESPONSE_DELAY_MS = 18_000;
