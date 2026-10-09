// The admin-facing half of task 9.0's "connect a new workspace" flow: issue
// a `state` before the admin opens a chat service's OAuth consent screen,
// and a verify entry point for whatever ends up calling back with it. See
// `oauth-install-state-service.ts`'s header for exactly what this task does
// and does NOT wire up end to end (that gap is reported in this task's
// status report, not papered over here).
//
// Mounted under this feature's own apiv3 prefix (`server/index.ts`), the
// same way `account-link-router.ts` is -- an ordinary logged-in-browser JSON
// API, not proxy-signed peer traffic, so this sits outside `/peer/` and
// needs no `express.raw` handling.
//
// `POST /state` requires a real, logged-in GROWI ADMIN (`loginRequiredFactory`
// + `adminRequiredFactory`) -- only an admin may start a "connect a new
// workspace" attempt (`AdminChatIntegration` boundary).
//
// `POST /verify` is deliberately NOT session-gated: the `state` value itself
// is the credential (single-use, short-lived, unpredictable -- exactly the
// same shape `account-link-router.ts`'s token-based endpoints and
// `pairing-endpoint.ts` already use for a caller that cannot carry a GROWI
// session). Whoever ends up calling this once the cross-repo wiring is
// decided -- `chat-integration-proxy` itself, or the admin's own browser via
// a redirect -- authenticates by presenting the token, not by being logged
// in as this GROWI's admin.

import type { PlatformName } from '@growi/chat';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler, Router } from 'express';
import express from 'express';
import { Types } from 'mongoose';

import type Crowi from '~/server/crowi';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import {
  issueOAuthInstallState,
  verifyOAuthInstallState,
} from './oauth-install-state-service';

interface AuthenticatedAdminRequest extends Request {
  readonly user: IUserHasId;
}

const SUPPORTED_PLATFORMS: readonly PlatformName[] = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];

const isPlatformName = (value: unknown): value is PlatformName =>
  typeof value === 'string' &&
  (SUPPORTED_PLATFORMS as readonly string[]).includes(value);

/**
 * `POST /state` -- issues a fresh `state` for the given `platform`.
 * `400` when `platform` is missing or not one of `@growi/chat`'s
 * `PlatformName` values; `200` with `{ state, expiresAt }` otherwise.
 */
const issueStateHandler = async (
  req: AuthenticatedAdminRequest,
  res: ApiV3Response,
): Promise<void> => {
  const { platform } = req.body as { platform?: unknown };
  if (!isPlatformName(platform)) {
    res.apiv3Err(
      new ErrorV3(
        `'platform' must be one of ${SUPPORTED_PLATFORMS.join(', ')}`,
        'invalid-platform',
      ),
      400,
    );
    return;
  }

  const issued = await issueOAuthInstallState(
    new Types.ObjectId(req.user._id),
    platform,
  );
  res.apiv3({ state: issued.state, expiresAt: issued.expiresAt.toISOString() });
};

/**
 * `POST /verify` -- verifies and one-time-consumes a candidate `state`.
 * `400` on an empty body field or any refusal (`unknown` / `expired` /
 * `already-consumed`) -- the task's own completion condition asks only that
 * an empty or failed-verification callback be refused with 400, not that
 * each reason surface a different status; `reason` is still returned in the
 * error body for whichever caller ends up driving this endpoint to act on.
 * `200` with `{ platform }` on success.
 */
const verifyStateHandler = async (
  req: Request,
  res: ApiV3Response,
): Promise<void> => {
  const { state } = req.body as { state?: unknown };
  const candidate = typeof state === 'string' ? state : '';

  const result = await verifyOAuthInstallState(candidate);
  if (!result.ok) {
    res.apiv3Err(
      new ErrorV3(
        'The OAuth install state is empty, unknown, expired, or already used.',
        result.reason,
      ),
      400,
    );
    return;
  }

  res.apiv3({ platform: result.platform });
};

export const createOAuthInstallRouter = (crowi: Crowi): Router => {
  const router = express.Router();
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  router.post(
    '/state',
    loginRequiredStrictly,
    adminRequired,
    issueStateHandler as unknown as RequestHandler,
  );
  router.post('/verify', verifyStateHandler as unknown as RequestHandler);

  return router;
};
