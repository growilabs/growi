// The receiving end of Requirement 2.2's save-time destination picker: one
// read-only endpoint that answers "which channels may I notify from this
// save?" for whoever is editing the page.
//
// Deliberately NOT part of `admin/admin-router.ts`, even though it serves
// the same channel list. That router requires a GROWI administrator, and
// the person choosing a destination at save time is an ordinary editor --
// reusing it would have made Requirement 2.2 an admin-only feature.
//
// Gated the same way a page save itself is (`excludeReadOnlyUser` alongside
// `loginRequiredStrictly`, matching `update-page.ts`/`create-page.ts`) --
// without it, a read-only user who cannot save a page at all could still
// enumerate every paired workspace's channels, private ones included.
//
// Ordinary logged-in-browser JSON requests, like `account-link-router.ts`
// and `manage-account-links-router.ts`: outside `/peer/`, so no
// `express.raw` handling and no proxy signature.

import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { Request, RequestHandler, Router } from 'express';
import express from 'express';

import type Crowi from '~/server/crowi';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { buildSaveTimeChannelsView } from './save-time-channels';

const logger = loggerFactory(
  'growi:features:chat-integration:notification:save-time-channels-router',
);

interface AuthenticatedRequest extends Request {
  readonly user: IUserHasId;
}

/**
 * `GET /` -- every channel every paired workspace can post to, plus the
 * workspaces whose list could not be fetched.
 *
 * Wrapped so the request is always answered: Express 4 ignores a rejected
 * promise from an `async` handler, which would leave the editor's picker
 * loading forever rather than falling back to showing nothing (same
 * reasoning as `admin-router.ts`'s `asHandler`).
 */
const listHandler = async (
  _req: AuthenticatedRequest,
  res: ApiV3Response,
): Promise<void> => {
  try {
    res.apiv3(await buildSaveTimeChannelsView());
  } catch (err) {
    logger.error('Could not build the save-time channel list', err);
    res.status(500).end();
  }
};

export const createSaveTimeChannelsRouter = (crowi: Crowi): Router => {
  const router = express.Router();
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  router.get(
    '/',
    loginRequiredStrictly,
    excludeReadOnlyUser,
    listHandler as unknown as RequestHandler,
  );

  return router;
};
