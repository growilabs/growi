import type { ResWithSafeRedirect } from '~/server/middlewares/safe-redirect';

import type { ApiV3Response } from './apiv3/interfaces/apiv3-response';

type LoginSuccessResponse = ApiV3Response & ResWithSafeRedirect;

/**
 * Send the response for a successful login.
 *
 * `respondWithRedirect` selects the response TRANSPORT, not whether the account is
 * external:
 * - `false` (default): reply with JSON `{ redirectTo }` via `res.apiv3`. Used by the
 *   AJAX login form (`POST /_api/v3/login`) for BOTH local and LDAP login — the client
 *   reads `redirectTo` from the body and navigates on its own (`router.push`).
 * - `true`: reply with an HTTP 302 via `res.safeRedirect`. Used by the OAuth/SAML callback
 *   routes (`GET`/`POST` under `/passport/`), which are full-page browser navigations that
 *   the server itself must redirect.
 *
 * NOTE: LDAP is an external account but still uses `false`, because it is submitted
 * through the AJAX form rather than a full-page callback. Passing `true` for LDAP returns
 * a 302 that the XHR follows silently, so the client never receives `redirectTo` and the
 * user stays on the login page until a manual reload. See issue #11384.
 */
export const sendLoginSuccessResponse = (
  res: LoginSuccessResponse,
  redirectTo: string,
  respondWithRedirect = false,
): void => {
  if (respondWithRedirect) {
    res.safeRedirect(redirectTo);
    return;
  }

  res.apiv3({ redirectTo });
};
