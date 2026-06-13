import { pipeline } from 'node:stream/promises';
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from 'express';
import express from 'express';

import {
  createVaultCredentialAdapter,
  type VaultAuthenticatedReq,
} from '~/features/growi-vault/server/middlewares/vault-pat-auth.js';
import { VaultSyncState } from '~/features/growi-vault/server/models/vault-sync-state.js';
import { vaultManagerClient } from '~/features/growi-vault/server/services/vault-manager-client.js';
import { vaultNamespaceMapper } from '~/features/growi-vault/server/services/vault-namespace-mapper.js';
import { vaultSettingsService } from '~/features/growi-vault/server/services/vault-settings-service.js';
import { SupportedAction } from '~/interfaces/activity.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import { generateUnavailableWhenMaintenanceModeMiddlewareForApi } from '~/server/middlewares/unavailable-when-maintenance-mode.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:features:growi-vault:routes:vault-gateway');

// ============================================================================
// Types
// ============================================================================

/** Activity-logger callback shape (see VaultGatewayRouterDeps.createActivity). */
type CreateActivity = (params: {
  ip: string | undefined;
  endpoint: string;
  action: string;
  user: string | undefined;
  snapshot: { username?: string };
}) => Promise<void>;

/**
 * Dependencies injected into the VaultGatewayRouter factory.
 * Using dependency injection keeps the router testable without side effects.
 */
export interface VaultGatewayRouterDeps {
  /**
   * Crowi instance used to build the standard middleware chain
   * (maintenanceMode + loginRequiredFactory). When omitted, those middlewares
   * are skipped (test mode only) — mirroring vault-page / vault-admin.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly crowi?: any;
  /**
   * Credential adapter (seam #1) Express middleware. Defaults to
   * `createVaultCredentialAdapter(createActivity)`. Tests may inject a stub.
   */
  readonly vaultPatAuth?: RequestHandler;
  /**
   * Optional activity logger callback. Called fire-and-forget after a
   * successful git operation, and on auth failures (via the credential
   * adapter / git fallback). Accepts the same shape as
   * activityService.createActivity().
   *
   * Keeping this as an optional callback (rather than accepting the full Crowi
   * object) limits coupling to the audit log interface alone.
   */
  readonly createActivity?: CreateActivity;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Check that vaultEnabled=true and bootstrapState==='done'.
 * Returns true when the gateway should proceed, false when a 404/503 was already sent.
 */
async function assertGatewayReady(
  req: Request,
  res: Response,
): Promise<boolean> {
  // Feature flag check (req 1.4).
  // 404 (not 503) because a disabled feature is a permanent configuration state,
  // not a transient unavailability — there is no Retry-After that would help.
  // From the client's perspective the repository simply does not exist on this server.
  const settings = await vaultSettingsService.getSettings();
  if (!settings.enabled) {
    logger.info(
      { path: req.originalUrl },
      'Vault gateway rejected: feature flag is disabled (VAULT_ENABLED). Responding 404.',
    );
    res.status(404).send('GROWI Vault is not enabled');
    return false;
  }

  // Bootstrap state check (req 1.5)
  const syncState = await VaultSyncState.findById('singleton').lean();
  const bootstrapState = syncState?.bootstrapState ?? 'pending';
  if (bootstrapState !== 'done') {
    // Only 'running' gets Retry-After since 'pending' and 'failed' won't change without admin action
    if (bootstrapState === 'running') {
      res.set('Retry-After', '60');
    }
    const message = (() => {
      switch (bootstrapState) {
        case 'pending':
          return 'GROWI Vault has not been initialised. Please ask your administrator to run the bootstrap from the Admin UI (/admin/vault).';
        case 'running':
          return 'GROWI Vault is initialising (bootstrap in progress). Please retry in a few minutes.';
        case 'failed':
          return 'GROWI Vault initialisation failed. Please ask your administrator to re-run the bootstrap from the Admin UI (/admin/vault).';
        default:
          return 'GROWI Vault is not ready. Please retry later.';
      }
    })();
    logger.warn(
      { path: req.originalUrl, bootstrapState },
      `Vault gateway rejected: bootstrap is not done (state=${bootstrapState}). Responding 503. Run bootstrap from /admin/vault.`,
    );
    res.status(503).send(message);
    return false;
  }

  return true;
}

/**
 * git-compatible fallback (seam #2) for `loginRequiredFactory`.
 *
 * The standard loginRequired fallback redirects an unauthenticated browser to
 * `/login`. A git client cannot follow that — so this fallback returns the
 * git-native challenge `401 + WWW-Authenticate: Basic realm="GROWI Vault"` and
 * records a VAULT_AUTH_FAILURE audit event (req 10.4). This is the single point
 * where the "anonymous + guests denied → 401" decision (req 2.4a) surfaces; the
 * guest/user decision itself is made by loginRequiredFactory via
 * `aclService.isGuestAllowedToRead()` (single source of truth — req 11).
 *
 * The response body intentionally carries no page content / list / existence
 * information (req 2.3).
 */
function createGitFallback(createActivity: CreateActivity | undefined) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    if (!res.headersSent) {
      res.setHeader('WWW-Authenticate', 'Basic realm="GROWI Vault"');
      res.status(401).end();
    } else {
      res.end();
    }

    createActivity?.({
      ip: req.ip,
      endpoint: req.originalUrl,
      action: SupportedAction.ACTION_VAULT_AUTH_FAILURE,
      user: undefined,
      snapshot: {},
    }).catch((err) =>
      logger.warn({ err }, 'Failed to record auth-failure activity'),
    );
  };
}

/**
 * Read the authenticated identity off the request.
 *
 * The credential adapter (seam #1) populated `req.user` with a securely
 * serialized user (when a valid PAT was presented) and stashed the PAT scopes
 * on `req.vaultScopes`. An anonymous-but-allowed request (guest read permitted)
 * reaches the handler with `req.user` unset → userId resolves to null and only
 * the 'public' namespace is accessible (req 3.2).
 */
function readIdentity(req: Request): {
  userId: string | null;
  scopes: ReadonlyArray<string> | undefined;
} {
  const authedReq = req as VaultAuthenticatedReq;
  const rawUser = authedReq.user as
    | { _id?: { toString(): string } }
    | undefined;
  const userId = rawUser?._id?.toString() ?? null;
  return { userId, scopes: authedReq.vaultScopes };
}

// ============================================================================
// Router factory
// ============================================================================

/**
 * Create and return the Express Router that handles all `/vault.git/*`
 * paths.
 *
 * Mount point: `/vault.git`
 * (Registered by the app's top-level router at `/vault.git`.)
 *
 * Authentication / authorisation is composed from the canonical apps/app
 * middleware chain so the gateway shares GROWI's single source of truth instead
 * of re-implementing authz (req 11):
 *
 *   [maintenanceMode] → credentialAdapter (seam #1)
 *     → loginRequiredFactory(crowi, isGuestAllowed=true, gitFallback) → handler
 *
 * The rate limiter is applied at the mount point (server/routes/index.js,
 * req 10.3) so it is intentionally NOT added here.
 *
 * Intentional deviations from the standard write-API chain (req 11.4 — these
 * are deliberate, not implicit drift):
 *  - No CSRF / `certifyOrigin`: git clients have no browser origin, and both
 *    `info/refs` (GET) and `git-upload-pack` (POST) are read-only.
 *  - No `excludeReadOnlyUser`: vault clone is read-only, so read-only users are
 *    allowed (the standard accessTokenParser rejects them for write-API safety).
 */
export const createVaultGatewayRouter = (
  deps: VaultGatewayRouterDeps = {},
): Router => {
  const { crowi, createActivity } = deps;
  const credentialAdapter =
    deps.vaultPatAuth ?? createVaultCredentialAdapter(createActivity);

  const router = express.Router();

  // --------------------------------------------------------------------------
  // Standard middleware chain (req 11).
  //
  // When crowi is omitted (legacy unit tests) the maintenanceMode +
  // loginRequired middlewares are skipped, mirroring vault-page / vault-admin.
  // The credential adapter always runs so handlers can read req.user.
  // --------------------------------------------------------------------------
  const authMiddlewares: RequestHandler[] =
    crowi != null
      ? [
          generateUnavailableWhenMaintenanceModeMiddlewareForApi(crowi),
          credentialAdapter,
          loginRequiredFactory(crowi, true, createGitFallback(createActivity)),
        ]
      : [credentialAdapter];

  // --------------------------------------------------------------------------
  // ANY /vault.git/git-receive-pack → 403 read-only (req 1.3)
  // Must be registered before the more specific GET/POST handlers.
  // Push rejection is unconditional and precedes auth — a write attempt is
  // always refused regardless of credential.
  // --------------------------------------------------------------------------
  router.all('/git-receive-pack', (_req: Request, res: Response) => {
    res.status(403).type('text/plain').send('read-only repository');
  });

  // --------------------------------------------------------------------------
  // GET /vault.git/info/refs  (clone / fetch discovery)
  // --------------------------------------------------------------------------
  router.get(
    '/info/refs',
    ...authMiddlewares,
    async (req: Request, res: Response) => {
      // Feature flag + bootstrap gate (req 1.4, 1.5)
      const ready = await assertGatewayReady(req, res);
      if (!ready) return;

      // Only git-upload-pack is supported (req 1.1 / Req 7)
      const { service } = req.query;
      if (service !== 'git-upload-pack') {
        res.status(400).send('Only git-upload-pack is supported');
        return;
      }

      // Identity resolved by the credential adapter + loginRequired chain.
      const { userId, scopes } = readIdentity(req);

      // Compute accessible namespaces (req 3, req 2.5)
      let namespaces: ReadonlyArray<string>;
      try {
        namespaces = await vaultNamespaceMapper.computeAccessibleNamespaces(
          userId,
          scopes,
        );
      } catch (err) {
        logger.error({ err }, 'Failed to compute accessible namespaces');
        res.status(500).send('Internal Server Error');
        return;
      }

      // Compose per-user view in vault-manager (req 6.1)
      let viewRef: string;
      try {
        const composed = await vaultManagerClient.composeView({
          userId,
          namespaces,
        });
        viewRef = composed.viewRef;
      } catch (err) {
        logger.warn({ err }, 'compose-view RPC failed');
        // Distinguish connection errors (503) from RPC errors (502)
        const isConnectionError =
          err instanceof Error &&
          (err.message.includes('ECONNREFUSED') ||
            err.message.includes('ENOTFOUND') ||
            err.message.includes('fetch failed'));
        res.status(isConnectionError ? 503 : 502).send('Upstream error');
        return;
      }

      // Audit log: clone-prepare (req 1.6)
      createActivity?.({
        ip: req.ip,
        endpoint: req.originalUrl,
        action: SupportedAction.ACTION_VAULT_CLONE_PREPARE,
        user: userId ?? undefined,
        snapshot: {},
      }).catch((err) =>
        logger.warn({ err }, 'Failed to record clone-prepare activity'),
      );

      // Proxy the git info/refs response from vault-manager (req 6.2)
      let proxyResult: Awaited<
        ReturnType<typeof vaultManagerClient.proxyGitRequest>
      >;
      try {
        proxyResult = await vaultManagerClient.proxyGitRequest({
          method: 'GET',
          path: '/internal/git/info/refs',
          viewRef,
          queryString: new URLSearchParams(
            req.query as Record<string, string>,
          ).toString(),
        });
      } catch (err) {
        logger.warn({ err }, 'git proxy request failed (info/refs)');
        const isConnectionError =
          err instanceof Error &&
          (err.message.includes('ECONNREFUSED') ||
            err.message.includes('ENOTFOUND') ||
            err.message.includes('fetch failed'));
        res.status(isConnectionError ? 503 : 502).send('Upstream error');
        return;
      }

      if (proxyResult.status >= 400) {
        res.status(502).send('Upstream returned an error');
        return;
      }

      // Forward Content-Type and status from the upstream response.
      res.status(proxyResult.status);
      const contentType =
        proxyResult.headers['content-type'] ??
        'application/x-git-upload-pack-advertisement';
      res.setHeader('Content-Type', contentType);

      try {
        await pipeline(proxyResult.body, res);
      } catch (err) {
        logger.warn({ err }, 'Stream pipeline error (info/refs)');
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /vault.git/git-upload-pack  (clone / fetch pack transfer)
  // --------------------------------------------------------------------------
  router.post(
    '/git-upload-pack',
    ...authMiddlewares,
    async (req: Request, res: Response) => {
      // Feature flag + bootstrap gate (req 1.4, 1.5)
      const ready = await assertGatewayReady(req, res);
      if (!ready) return;

      // Identity resolved by the credential adapter + loginRequired chain.
      const { userId, scopes } = readIdentity(req);

      // Compute accessible namespaces (req 3, req 2.5)
      let namespaces: ReadonlyArray<string>;
      try {
        namespaces = await vaultNamespaceMapper.computeAccessibleNamespaces(
          userId,
          scopes,
        );
      } catch (err) {
        logger.error({ err }, 'Failed to compute accessible namespaces');
        res.status(500).send('Internal Server Error');
        return;
      }

      // Compose per-user view in vault-manager (req 6.1)
      let viewRef: string;
      try {
        const composed = await vaultManagerClient.composeView({
          userId,
          namespaces,
        });
        viewRef = composed.viewRef;
      } catch (err) {
        logger.warn({ err }, 'compose-view RPC failed (git-upload-pack)');
        const isConnectionError =
          err instanceof Error &&
          (err.message.includes('ECONNREFUSED') ||
            err.message.includes('ENOTFOUND') ||
            err.message.includes('fetch failed'));
        res.status(isConnectionError ? 503 : 502).send('Upstream error');
        return;
      }

      // Proxy the pack upload to vault-manager (req 6.2)
      let proxyResult: Awaited<
        ReturnType<typeof vaultManagerClient.proxyGitRequest>
      >;
      try {
        proxyResult = await vaultManagerClient.proxyGitRequest({
          method: 'POST',
          path: '/internal/git/git-upload-pack',
          viewRef,
          requestBody: req,
        });
      } catch (err) {
        logger.warn({ err }, 'git proxy request failed (git-upload-pack)');
        const isConnectionError =
          err instanceof Error &&
          (err.message.includes('ECONNREFUSED') ||
            err.message.includes('ENOTFOUND') ||
            err.message.includes('fetch failed'));
        res.status(isConnectionError ? 503 : 502).send('Upstream error');
        return;
      }

      if (proxyResult.status >= 400) {
        res.status(502).send('Upstream returned an error');
        return;
      }

      // Forward Content-Type and status.
      res.status(proxyResult.status);
      const contentType =
        proxyResult.headers['content-type'] ??
        'application/x-git-upload-pack-result';
      res.setHeader('Content-Type', contentType);

      // Audit log: clone-complete (req 1.6)
      createActivity?.({
        ip: req.ip,
        endpoint: req.originalUrl,
        action: SupportedAction.ACTION_VAULT_CLONE_COMPLETE,
        user: userId ?? undefined,
        snapshot: {},
      }).catch((err) =>
        logger.warn({ err }, 'Failed to record clone-complete activity'),
      );

      try {
        await pipeline(proxyResult.body, res);
      } catch (err) {
        logger.warn({ err }, 'Stream pipeline error (git-upload-pack)');
      }
    },
  );

  // --------------------------------------------------------------------------
  // Catch-all: any other /vault.git/* path → 404 (req 1.7)
  // --------------------------------------------------------------------------
  router.all('*', (_req: Request, res: Response) => {
    res.status(404).send('Not Found');
  });

  return router;
};
