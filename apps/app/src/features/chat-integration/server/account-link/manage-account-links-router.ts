// Requirement 7.7's own screen: "list my chat account links, unlink one
// individually" -- a PERMANENT personal-settings tab, distinct from task
// 6.1's one-time-link approval screen (`account-link-router.ts`). Mounted
// on its own prefix (`/my-account-links`, see `server/index.ts`), not under
// `/account-link`, so its literal `/` and `/:id` routes never have to be
// ordered around `account-link-router.ts`'s `/:token` param route.
//
// Ordinary logged-in-browser JSON requests, exactly like
// `account-link-router.ts` -- not proxy-signed peer traffic, so this sits
// outside `/peer/` and needs no `express.raw` handling.

import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { Request, RequestHandler, Router } from 'express';
import express from 'express';

import type Crowi from '~/server/crowi';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import {
  listAccountLinksForUser,
  unlinkAccountLink,
} from './manage-account-links-service';

interface AuthenticatedRequest extends Request {
  readonly user: IUserHasId;
}

/** `GET /` -- the current user's own chat account links, never anyone else's. */
const listHandler = async (
  req: AuthenticatedRequest,
  res: ApiV3Response,
): Promise<void> => {
  const links = await listAccountLinksForUser(req.user._id);
  res.apiv3({ links });
};

/**
 * `DELETE /:id` -- unlink one of the CURRENT user's own links.
 * `unlinkAccountLink` scopes the delete to `req.user._id`, so an id that
 * belongs to a different user answers 404, identically to an id that does
 * not exist at all (no distinguishable "yes but it's not yours" response).
 */
const unlinkHandler = async (
  req: AuthenticatedRequest,
  res: ApiV3Response,
): Promise<void> => {
  const { id } = req.params;
  const result = await unlinkAccountLink(req.user._id, id);

  if (result === 'not-found') {
    res.status(404).end();
    return;
  }
  res.apiv3({ status: 'unlinked' });
};

export const createManageAccountLinksRouter = (crowi: Crowi): Router => {
  const router = express.Router();
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  // `excludeReadOnlyUser` mirrors `server/routes/apiv3/personal-setting/`'s
  // convention (e.g. `get-access-tokens.ts`, `delete-access-token.ts`),
  // which gates both read and write personal-setting endpoints on it, not
  // only mutations.
  router.get(
    '/',
    loginRequiredStrictly,
    excludeReadOnlyUser,
    listHandler as unknown as RequestHandler,
  );
  router.delete(
    '/:id',
    loginRequiredStrictly,
    excludeReadOnlyUser,
    unlinkHandler as unknown as RequestHandler,
  );

  return router;
};
