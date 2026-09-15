// Task 9.1's admin screen backend: the receiving end for the 3 things the
// admin screen has to show (design.md "管理画面と個人設定" -- Requirements
// 1.3, 1.4, 12.5) plus the write operations it exposes: Requirement 9.1's
// pairing submission (`submitPairingRequest`, task 7.3), task 9.2's
// channel-permission settings save (`saveRelationSettings`, Requirements
// 11.1/11.2/11.4), and Requirement 9.7's disconnect (`unpairRelation`) --
// this router is that function's only production caller, see
// `unpairRelationHandler` below.
//
// Every endpoint here requires a real, logged-in GROWI ADMIN
// (`loginRequiredFactory` + `adminRequiredFactory`) -- same convention as
// `oauth-install-router.ts`'s `POST /state`. Ordinary logged-in-browser JSON
// requests, mounted under this feature's own apiv3 prefix
// (`server/index.ts`), outside `/peer/`.
//
// What this endpoint does NOT do, deliberately, per this task's own
// completion condition ("画面が出て、使える機能と連携の状態が読めることが試験で
// 示される" -- read-only for capabilities/status):
//   - It does not invent per-platform capability logic. `GET
//     /relations/:relationId/capabilities` relays `CapabilityReport` from
//     `fetchCapabilities` (task 7.1) VERBATIM -- no field is dropped,
//     renamed, or branched on by platform. The task's own text warns against
//     this ("独自に「このサービスはスラッシュコマンドが使える」等を決め打ちしない
//     こと").
//   - It does not build the "connect a new workspace via OAuth" flow. That
//     flow is not wired end to end yet (tasks.md's Implementation Notes on
//     task 9.0: the proxy-side authorization-URL endpoint and the
//     proxy→GROWI callback verification are both out of this spec's
//     boundary). The pairing operation this screen exposes is the
//     REGISTRATION-CODE mechanism instead (task 7.3's
//     `submitPairingRequest`), which needs no OAuth round trip at all --
//     `issueOAuthInstallState`/`verifyOAuthInstallState` (task 9.0) remain
//     unused by this router until that cross-repo wiring exists.

import type { IUserHasId } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler, Router } from 'express';
import express from 'express';
import { Types } from 'mongoose';

import type Crowi from '~/server/crowi';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { describeChatKeyEncryptionConfiguration } from '../keys';
import {
  submitPairingRequest,
  unpairRelation,
} from '../pairing/pairing-service';
import { fetchCapabilities, fetchConnectionStatus } from '../proxy-client';
import { readRelationSettings } from '../settings/relation-settings-store';
import { listRelationsForAdmin } from './admin-service';
import {
  type Gen1NotificationSettingSource,
  readGen1SlackChannelNames,
} from './gen1-slack-channel-names';
import {
  buildNotificationDestinationsView,
  saveNotificationDestination,
} from './notification-destinations';
import { saveRelationSettings } from './save-relation-settings';

const logger = loggerFactory(
  'growi:features:chat-integration:admin:admin-router',
);

interface AuthenticatedAdminRequest extends Request {
  readonly user: IUserHasId;
}

type ChatAdminHandler = (
  req: AuthenticatedAdminRequest,
  res: ApiV3Response,
) => Promise<void> | void;

/**
 * Turns one of this file's handlers into an Express handler that ALWAYS
 * answers.
 *
 * Express 4 does not look at what an `async` handler's promise does: a
 * rejection is neither passed to the error-handling middleware nor turned
 * into a response, so an unexpected throw anywhere inside a handler leaves
 * the request with no answer at all -- the browser waits until it gives up.
 * That is not hypothetical here: a settings save runs a MongoDB
 * transaction, and a transaction can be refused (see
 * `save-relation-settings.ts`'s `save-conflict`); a database that is
 * momentarily unavailable does the same to every other handler.
 *
 * So every route below is wrapped, once, here -- rather than each handler
 * growing its own `try`/`catch`, which is the arrangement one handler
 * eventually gets wrong. `500` because a throw reaching this point is by
 * definition not an outcome any handler recognised: the expected ones are
 * all returned as values and mapped to their own status codes.
 */
const asHandler =
  (handler: ChatAdminHandler): RequestHandler =>
  (req, res) => {
    const typedRes = res as unknown as ApiV3Response;
    void (async () => {
      try {
        await handler(req as AuthenticatedAdminRequest, typedRes);
      } catch (err) {
        logger.error(
          `Unexpected failure while handling ${req.originalUrl}:`,
          err,
        );
        typedRes.apiv3Err(
          new ErrorV3(
            'This request failed unexpectedly. Try again.',
            'unexpected-error',
          ),
          500,
        );
      }
    })();
  };

/** `GET /encryption-status` -- whether pairing may proceed at all (task 1.3). */
const encryptionStatusHandler = (_req: Request, res: ApiV3Response): void => {
  res.apiv3(describeChatKeyEncryptionConfiguration());
};

/** `GET /relations` -- every relation this GROWI has paired with, active or not. */
const listRelationsHandler = async (
  _req: Request,
  res: ApiV3Response,
): Promise<void> => {
  const relations = await listRelationsForAdmin();
  res.apiv3({ relations });
};

/**
 * `GET /relations/:relationId/capabilities` -- relays `CapabilityReport`
 * (Requirement 1.3) exactly as the proxy answered it. `502` on any
 * `ProxyCallFailure` -- the admin screen distinguishes "the proxy said no
 * capabilities" (which cannot happen; the report always has a body) from
 * "the call itself failed", not different sub-reasons of the latter, since
 * every reason means the same thing to an operator here: "try again / check
 * the proxy".
 */
const capabilitiesHandler = async (
  req: Request,
  res: ApiV3Response,
): Promise<void> => {
  const { relationId } = req.params;
  const result = await fetchCapabilities(relationId);
  if (!result.ok) {
    res.apiv3Err(
      new ErrorV3(
        `Could not fetch capabilities from the proxy: ${result.reason}`,
        result.reason,
      ),
      502,
    );
    return;
  }
  res.apiv3(result.response);
};

/**
 * `GET /relations/:relationId/connection-status` -- relays
 * `ConnectionStatusView` (Requirement 1.4) exactly as the proxy answered it.
 */
const connectionStatusHandler = async (
  req: Request,
  res: ApiV3Response,
): Promise<void> => {
  const { relationId } = req.params;
  const result = await fetchConnectionStatus(relationId);
  if (!result.ok) {
    res.apiv3Err(
      new ErrorV3(
        `Could not fetch connection status from the proxy: ${result.reason}`,
        result.reason,
      ),
      502,
    );
    return;
  }
  res.apiv3(result.response);
};

/**
 * `GET /relations/:relationId/settings` -- this relation's channel
 * permissions and its current settings version, read through the very same
 * function `settings-pull` answers the proxy with
 * (`readRelationSettings`), so the screen an administrator edits shows what
 * the proxy is actually being told.
 */
const getSettingsHandler = async (
  req: Request,
  res: ApiV3Response,
): Promise<void> => {
  const { relationId } = req.params;
  const settings = await readRelationSettings(relationId);
  if (settings == null) {
    res.apiv3Err(
      new ErrorV3(
        `Relation '${relationId}' is not found`,
        'relation-not-found',
      ),
      404,
    );
    return;
  }
  res.apiv3(settings);
};

/**
 * `POST /relations/:relationId/settings` -- saves the relation's channel
 * permissions (task 9.2, Requirements 11.1/11.2/11.4).
 *
 * The whole set is sent and stored wholesale, matching what goes over the
 * wire to the proxy; there is no per-command endpoint.
 *
 * A push failure is NOT an error here: `saveRelationSettings` still answers
 * `saved`, and this handler relays that as `200` with `push: { ok: false,
 * reason }` so the screen can say "saved, but the proxy has not been told
 * yet -- it will fetch it". Answering an error status would tell the
 * administrator nothing was saved, which is false (see
 * `save-relation-settings.ts`).
 *
 * A refused write IS an error, and a distinct one: `409` for
 * `save-conflict`, because in that case nothing was committed and saving
 * again is all that is needed. Anything that throws instead of answering is
 * caught by `asHandler` above and becomes a `500` -- never a request left
 * without a response.
 */
const saveSettingsHandler = async (
  req: Request,
  res: ApiV3Response,
): Promise<void> => {
  const { relationId } = req.params;
  const { channelPermissions } = req.body as {
    readonly channelPermissions?: unknown;
  };

  const outcome = await saveRelationSettings(relationId, channelPermissions);

  if (outcome.status === 'invalid-settings') {
    res.apiv3Err(new ErrorV3(outcome.detail, 'invalid-settings'), 400);
    return;
  }
  if (outcome.status === 'relation-not-found') {
    res.apiv3Err(
      new ErrorV3(
        `Relation '${relationId}' is not found, or is no longer paired`,
        'relation-not-found',
      ),
      404,
    );
    return;
  }
  if (outcome.status === 'save-conflict') {
    res.apiv3Err(
      new ErrorV3(
        'Someone else saved these settings at the same time, so nothing was saved. Reload the screen and try again.',
        'save-conflict',
      ),
      409,
    );
    return;
  }
  res.apiv3(outcome);
};

/**
 * Gen 1's notification settings, as a read-only source of channel NAMES for
 * Requirement 12.4's overlap check (task 9.3).
 *
 * `crowi.models` is typed as a bag of `Model<any>`, which declares none of
 * Gen 1's statics, so the one narrowing cast this feature makes against Gen
 * 1 lives here -- at the boundary, in one place, to the smallest shape that
 * is actually used (`findAll`, see `gen1-slack-channel-names.ts`). Nothing
 * is written through it.
 */
const gen1NotificationSettings = (
  crowi: Crowi,
): Gen1NotificationSettingSource | undefined =>
  crowi.models.GlobalNotificationSetting as unknown as
    | Gen1NotificationSettingSource
    | undefined;

/**
 * `GET /relations/:relationId/notification-destinations` -- the destination
 * editor's whole state in one call: the channel list to pick from, the
 * destinations configured now, and Requirement 12.4's overlap warnings.
 *
 * The channel list is fetched here rather than from its own endpoint so the
 * overlap warnings are computed AFTER the stored names have been refreshed
 * from that same fetch (see `notification-destinations.ts`). A proxy that
 * cannot be reached is NOT an error status: what is configured is still
 * shown, with `channelsUnavailable` explaining the missing picker.
 */
const listNotificationDestinationsHandler =
  (crowi: Crowi): ChatAdminHandler =>
  async (req, res): Promise<void> => {
    const { relationId } = req.params;
    const gen1ChannelNames = await readGen1SlackChannelNames(
      gen1NotificationSettings(crowi),
    );
    res.apiv3(
      await buildNotificationDestinationsView(relationId, gen1ChannelNames),
    );
  };

/**
 * `POST /relations/:relationId/notification-destinations` -- saves one
 * destination, identified by the channel's IDENTIFIER (Requirement 2.2).
 *
 * `400` for a malformed body and for a channel id that is not in the list
 * the chat service reports (both are "fix the request"); `404` for a
 * relation that is not paired; `502` when the channel list could not be
 * fetched at all, since nothing about the request is wrong in that case and
 * retrying is the remedy.
 */
const saveNotificationDestinationHandler: ChatAdminHandler = async (
  req,
  res,
) => {
  const { relationId } = req.params;
  const outcome = await saveNotificationDestination(relationId, req.body);

  if (
    outcome.status === 'invalid-destination' ||
    outcome.status === 'unknown-channel'
  ) {
    res.apiv3Err(new ErrorV3(outcome.detail, outcome.status), 400);
    return;
  }
  if (outcome.status === 'relation-not-found') {
    res.apiv3Err(
      new ErrorV3(
        `Relation '${relationId}' is not found, or is no longer paired`,
        'relation-not-found',
      ),
      404,
    );
    return;
  }
  if (outcome.status === 'channels-unavailable') {
    res.apiv3Err(
      new ErrorV3(
        `Could not fetch the channel list from the proxy: ${outcome.reason}`,
        'channels-unavailable',
      ),
      502,
    );
    return;
  }
  res.apiv3(outcome);
};

interface PairingRequestBody {
  readonly registrationCode?: unknown;
  readonly proxyUri?: unknown;
  readonly growiUri?: unknown;
  readonly growiLabel?: unknown;
}

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * `POST /pairing` -- submits a registration code (task 7.3). This is the
 * ONLY pairing operation this screen exposes -- see this file's header on
 * why the OAuth "Add to Slack"-style flow is not built here.
 *
 * `submitPairingRequest` itself refuses when the encryption key is
 * unconfigured (returning `{ status: 'key-encryption-unconfigured' }`), so
 * this handler does not duplicate that check -- a second copy here would be
 * a second place that could drift from the single source of truth in
 * `pairing-service.ts`. `400` for a malformed request body; every outcome
 * `submitPairingRequest` can produce is relayed as `200` with its own
 * `status` field, since each is a distinct, expected result the admin
 * screen renders differently (not an HTTP-level error).
 */
const submitPairingHandler = async (
  req: AuthenticatedAdminRequest,
  res: ApiV3Response,
): Promise<void> => {
  const body = req.body as PairingRequestBody;
  const registrationCode = asNonEmptyString(body.registrationCode);
  const proxyUri = asNonEmptyString(body.proxyUri);
  const growiUri = asNonEmptyString(body.growiUri);
  const growiLabel = asNonEmptyString(body.growiLabel);

  if (
    registrationCode == null ||
    proxyUri == null ||
    growiUri == null ||
    growiLabel == null
  ) {
    res.apiv3Err(
      new ErrorV3(
        "'registrationCode', 'proxyUri', 'growiUri', and 'growiLabel' are all required",
        'invalid-pairing-request',
      ),
      400,
    );
    return;
  }

  const outcome = await submitPairingRequest({
    registrationCode,
    proxyUri,
    growiUri,
    growiLabel,
    createdBy: new Types.ObjectId(req.user._id),
  });
  res.apiv3(outcome);
};

/**
 * `POST /relations/:relationId/unpair` -- disconnects a chat workspace
 * (Requirement 9.7). This is the ONLY production caller of
 * `unpairRelation`, and it has to exist for two other pieces of this feature
 * to have anything to work on at all: the 90-day sweep
 * (`sweep-unpaired-relations.ts`) looks for `state: 'unpaired'` rows, and a
 * re-pairing inherits the previous relation's account links from the most
 * recent `unpaired` row for the same workspace
 * (`inherit-account-links.ts`). `state: 'unpaired'` is written nowhere else,
 * so without this route both of them would sit idle forever and an
 * unpair-then-re-pair would silently lose every user's chat account link.
 *
 * `POST .../unpair` rather than `DELETE /relations/:relationId`: the
 * `chat_relations` row deliberately SURVIVES (design.md: `platform` and
 * `workspaceId` are the only thing a later re-pairing recognises the same
 * workspace by), so a method that reads as "remove this relation" would
 * describe the wrong thing. Deleting the row is the sweep's job.
 *
 * `404` only for a relation this GROWI has no row for. A relation that is
 * ALREADY unpaired answers `200`, unchanged: `unpairRelation` filters its
 * own state transition on `state: 'active'` and is the single source of
 * truth for it, so a second state check here would be a second place that
 * could drift from it (the same reasoning as `submitPairingHandler` above).
 */
const unpairRelationHandler = async (
  req: Request,
  res: ApiV3Response,
): Promise<void> => {
  const { relationId } = req.params;
  const result = await unpairRelation(relationId);

  if (result === 'not-found') {
    res.apiv3Err(
      new ErrorV3(
        `Relation '${relationId}' is not found`,
        'relation-not-found',
      ),
      404,
    );
    return;
  }
  res.apiv3({ status: result });
};

export const createAdminRouter = (crowi: Crowi): Router => {
  const router = express.Router();
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  router.use(loginRequiredStrictly, adminRequired);

  router.get('/encryption-status', asHandler(encryptionStatusHandler));
  router.get('/relations', asHandler(listRelationsHandler));
  router.get(
    '/relations/:relationId/capabilities',
    asHandler(capabilitiesHandler),
  );
  router.get(
    '/relations/:relationId/connection-status',
    asHandler(connectionStatusHandler),
  );
  router.get('/relations/:relationId/settings', asHandler(getSettingsHandler));
  router.post(
    '/relations/:relationId/settings',
    asHandler(saveSettingsHandler),
  );
  router.get(
    '/relations/:relationId/notification-destinations',
    asHandler(listNotificationDestinationsHandler(crowi)),
  );
  router.post(
    '/relations/:relationId/notification-destinations',
    asHandler(saveNotificationDestinationHandler),
  );
  router.post('/pairing', asHandler(submitPairingHandler));
  router.post(
    '/relations/:relationId/unpair',
    asHandler(unpairRelationHandler),
  );

  return router;
};
