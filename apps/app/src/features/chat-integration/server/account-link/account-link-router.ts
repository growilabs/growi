// The two endpoints the approval screen (task 6.1's `pages/` entry, see
// `apps/app/src/pages/me/[[...path]].page.tsx`) talks to: "what am I about
// to approve" and "approve it". Mounted under this feature's own apiv3
// prefix (`server/index.ts`'s `createChatIntegrationRouter`), NOT under
// `/peer/` -- these are ordinary logged-in-browser JSON requests, not
// proxy-signed peer traffic (design.md: "同じ feature の中に管理画面が叩く口
// もあり、そちらは普通の JSON API である").
//
// Both handlers require a real, logged-in GROWI session
// (`loginRequiredFactory`) -- this is the actual enforcement point for
// Requirement 7.3's "ログインした状態で...承認したときに成立する". The
// `/me/*` Express route this screen's page lives under (task 3.5's sibling
// registration in `server/routes/index.js`, confirmed already covering
// `/me/chat-integration/account-link/:token` -- see this task's design
// notes) also requires login before Next.js ever renders the page, but this
// router does not rely on that alone: the API itself must refuse an
// unauthenticated caller too, since nothing stops a request from reaching
// this apiv3 endpoint directly.
//
// No `req.body` re-parsing concerns here (unlike `peer-router.ts`) --
// nothing in this router sits behind `express.raw`; it uses the app-wide
// JSON body parser like any other apiv3 route.

import type { IUserHasId } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler, Router } from 'express';
import express from 'express';

import type Crowi from '~/server/crowi';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import {
  approveAccountLink,
  getAccountLinkOrderForApproval,
} from './account-link-service';

interface AuthenticatedRequest extends Request {
  readonly user: IUserHasId;
}

/**
 * `GET /:token` -- display data for the approval screen. Answers a uniform
 * 404 whenever the token does not resolve to a live order, regardless of
 * WHY (does not exist / already used / expired) -- see
 * `account-link-service.ts`'s comment on `getAccountLinkOrderForApproval`.
 */
const getOrderHandler = async (
  req: AuthenticatedRequest,
  res: ApiV3Response,
): Promise<void> => {
  const { user } = req;
  const { token } = req.params;

  const result = await getAccountLinkOrderForApproval(token, user);
  if (result.status === 'not-found') {
    res.status(404).end();
    return;
  }

  res.apiv3(result.display);
};

/**
 * `POST /:token/approve` -- the actual link + revoke (Requirement 7.4).
 * Status codes:
 *  - `200` -- linked.
 *  - `404` -- token does not exist, was already used, or has expired.
 *  - `409` -- the chat account is already linked to a DIFFERENT GROWI user
 *    (the composite unique index rejected the insert).
 */
const approveOrderHandler = async (
  req: AuthenticatedRequest,
  res: ApiV3Response,
): Promise<void> => {
  const { user } = req;
  const { token } = req.params;

  const result = await approveAccountLink(token, user);

  switch (result.status) {
    case 'linked':
      res.apiv3({ status: 'linked' });
      return;
    case 'invalid-or-expired':
      res.status(404).end();
      return;
    case 'taken-by-another-user':
      res.apiv3Err(
        new ErrorV3(
          'This chat account is already linked to a different GROWI user.',
          'taken-by-another-user',
        ),
        409,
      );
      return;
    default: {
      // Exhaustiveness guard -- a new ApproveAccountLinkResult variant must
      // be handled above, not silently fall through to a wrong status code.
      const _exhaustive: never = result;
      throw new Error(`Unhandled account-link approval status: ${_exhaustive}`);
    }
  }
};

export const createAccountLinkRouter = (crowi: Crowi): Router => {
  const router = express.Router();
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  // Cast at the registration boundary, not inside each handler -- Express's
  // `RequestHandler` type is intentionally generic; both handlers above are
  // written against the narrower, more useful `AuthenticatedRequest` /
  // `ApiV3Response` shapes this router actually receives once
  // `loginRequiredStrictly` and the app-wide `addCustomFunctionToResponse`
  // have run (mirrors `personal-setting/get-access-tokens.ts`'s convention).
  router.get(
    '/:token',
    loginRequiredStrictly,
    getOrderHandler as unknown as RequestHandler,
  );
  router.post(
    '/:token/approve',
    loginRequiredStrictly,
    approveOrderHandler as unknown as RequestHandler,
  );

  return router;
};
