import { mock } from 'vitest-mock-extended';

import type { ResWithSafeRedirect } from '~/server/middlewares/safe-redirect';

import type { ApiV3Response } from './apiv3/interfaces/apiv3-response';
import { sendLoginSuccessResponse } from './login-success-response';

type LoginSuccessResponse = ApiV3Response & ResWithSafeRedirect;

describe('sendLoginSuccessResponse', () => {
  const redirectTo = '/path/to/redirect';

  // Contract: the response TRANSPORT the client experiences (JSON body vs HTTP 302),
  // not which internal helper is called. See issue #11384.

  describe('when respondWithRedirect is omitted (AJAX login form: local & LDAP)', () => {
    it('responds with JSON { redirectTo } and never issues a redirect', () => {
      // Arrange
      const res = mock<LoginSuccessResponse>();

      // Act
      sendLoginSuccessResponse(res, redirectTo);

      // Assert: the client reads redirectTo from the body and navigates itself.
      // A 302 here would be followed silently by the XHR (the #11384 regression).
      expect(res.apiv3).toHaveBeenCalledWith({ redirectTo });
      expect(res.safeRedirect).not.toHaveBeenCalled();
    });
  });

  describe('when respondWithRedirect is false', () => {
    it('responds with JSON { redirectTo } and never issues a redirect', () => {
      const res = mock<LoginSuccessResponse>();

      sendLoginSuccessResponse(res, redirectTo, false);

      expect(res.apiv3).toHaveBeenCalledWith({ redirectTo });
      expect(res.safeRedirect).not.toHaveBeenCalled();
    });
  });

  describe('when respondWithRedirect is true (full-page callback: OAuth/SAML)', () => {
    it('responds with an HTTP 302 and never returns a JSON body', () => {
      const res = mock<LoginSuccessResponse>();

      sendLoginSuccessResponse(res, redirectTo, true);

      expect(res.safeRedirect).toHaveBeenCalledWith(redirectTo);
      expect(res.apiv3).not.toHaveBeenCalled();
    });
  });
});
