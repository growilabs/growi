import express from 'express';

import type Crowi from '~/server/crowi';

/**
 * Chat Integration (Gen 2) feature — server entry point.
 *
 * This module is the single place from which every Mongoose model this
 * feature owns must be statically imported (never lazily, from inside a
 * request handler). GROWI registers a model's indexes the moment it is
 * `import`-ed — `mongoose.model()` runs at import time and there is no
 * `autoIndex: false` anywhere in this codebase — so a model that is only
 * reachable via a lazy/dynamic import has no index until the feature is
 * first used. This spec's `chat_account_links` composite unique index
 * (`(relationId, platform, accountId)`) enforces a correctness invariant
 * (requirement 7.4), so a window with no index is a window where a
 * duplicate account link can be created.
 *
 * `server/routes/apiv3/index.js` is loaded on every GROWI process start and
 * statically imports this file (see its `createChatIntegrationRouter`
 * import), so anything this file imports — directly or transitively — is
 * guaranteed to load before the application accepts traffic. This mirrors
 * `features/growi-vault/server/index.ts`.
 */

// All 12 collections this spec owns (design.md "Data Models"). Side-effect
// imports only: each module's `getOrCreateModel(...)` call registers the
// model (and its indexes) with Mongoose at import time. Do NOT move these
// into `setup-models.ts`'s `setupIndependentModels()` -- that path is only
// reached from import/restore, not from server boot (see design.md "新しい
// model がいつ読み込まれるか").
import './models/chat-relation';
import './models/chat-notification-destination';
import './models/chat-processed-request';
import './models/chat-request-nonce';
import './account-link/models/chat-account-link';
import './account-link/models/chat-account-link-order';
import './keys/models/chat-integration-key';
import './pairing/models/pending-pairing';
import './pairing/models/chat-challenge-attempt';
import './notification/models/chat-notification-outbox';
import './settings/models/chat-channel-permission';
import './oauth-install-state/models/chat-oauth-install-state';

import { createAccountLinkRouter } from './account-link/account-link-router';
import { createManageAccountLinksRouter } from './account-link/manage-account-links-router';
import { createAdminRouter } from './admin/admin-router';
import { createSaveTimeChannelsRouter } from './notification/save-time-channels-router';
import { createOAuthInstallRouter } from './oauth-install-state/oauth-install-router';
import { createPeerRouter } from './peer/peer-router';

/**
 * `crowi` is threaded through to the `command` op's handler (task 5.1),
 * which needs `crowi.searchService`, `crowi.aclService` and
 * `crowi.appService` -- unlike the model imports above, these are
 * per-instance services with no module-level singleton to import instead.
 */
export const createChatIntegrationRouter = (crowi: Crowi): express.Router => {
  const router = express.Router();
  // The 6 entry points the proxy calls (task 3.5) -- `createPeerRouter`
  // already carries its own full paths (`/peer/...`) relative to this
  // feature's own mount point (`/chat-integration`, registered once in
  // `server/routes/apiv3/index.js`), so no extra prefix is added here.
  router.use(createPeerRouter(crowi));
  // The browser-facing approval screen's API (task 6.1) -- ordinary
  // logged-in JSON requests, mounted separately from `/peer/` (design.md:
  // "同じ feature の中に管理画面が叩く口もあり、そちらは普通の JSON API
  // である").
  router.use('/account-link', createAccountLinkRouter(crowi));
  // The personal-settings "my chat account links" tab (task 6.2, Requirement
  // 7.7) -- its own prefix, separate from `/account-link` above, so its
  // literal `/` and `/:id` routes never collide with that router's `/:token`
  // param route.
  router.use('/my-account-links', createManageAccountLinksRouter(crowi));
  // "Connect a new workspace" state issue/verify (task 9.0) -- the admin
  // screen's own prefix, separate from `/account-link` and
  // `/my-account-links` above.
  router.use('/oauth-install', createOAuthInstallRouter(crowi));
  // The page editor's save-time destination picker (task 9.3, Requirement
  // 2.2) -- readable by any logged-in editor, unlike `/admin` below.
  router.use('/notification-channels', createSaveTimeChannelsRouter(crowi));
  // The admin screen's own API (task 9.1) -- relation list, capability/
  // connection-status relay, encryption-key status, and pairing submission.
  // Its own prefix, separate from every router above.
  router.use('/admin', createAdminRouter(crowi));
  return router;
};
