import { pipeline } from 'node:stream/promises';
import type { Request, Response, Router } from 'express';
import express from 'express';

import { SupportedAction } from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';

import type { VaultPatAuth } from '../middlewares/vault-pat-auth';
import { vaultPatAuth as defaultVaultPatAuth } from '../middlewares/vault-pat-auth';
import { VaultSyncState } from '../models/vault-sync-state';
import { vaultManagerClient } from '../services/vault-manager-client';
import { vaultNamespaceMapper } from '../services/vault-namespace-mapper';
import { vaultSettingsService } from '../services/vault-settings-service';

const logger = loggerFactory('growi:features:growi-vault:routes:vault-gateway');

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies injected into the VaultGatewayRouter factory.
 * Using dependency injection keeps the router testable without side effects.
 */
export interface VaultGatewayRouterDeps {
  /** PAT authenticator; defaults to the module-level singleton. */
  readonly vaultPatAuth?: VaultPatAuth;
  /**
   * Optional activity logger callback. Called fire-and-forget after a
   * successful git operation. Accepts the same shape as
   * activityService.createActivity().
   *
   * Keeping this as an optional callback (rather than accepting the full Crowi
   * object) limits coupling to the audit log interface alone.
   */
  readonly createActivity?: (params: {
    ip: string | undefined;
    endpoint: string;
    action: string;
    user: string | undefined;
    snapshot: { username?: string };
  }) => Promise<void>;
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

// ============================================================================
// Router factory
// ============================================================================

/**
 * Create and return the Express Router that handles all `/vault.git/*`
 * paths.
 *
 * Mount point: `/vault.git`
 * (Registered by the app's top-level router at `/vault.git`.)
 */
export const createVaultGatewayRouter = (
  deps: VaultGatewayRouterDeps = {},
): Router => {
  const auth = deps.vaultPatAuth ?? defaultVaultPatAuth;
  const createActivity = deps.createActivity;

  const router = express.Router();

  // --------------------------------------------------------------------------
  // ANY /vault.git/git-receive-pack → 403 read-only (req 1.3)
  // Must be registered before the more specific GET/POST handlers.
  // --------------------------------------------------------------------------
  router.all('/git-receive-pack', (_req: Request, res: Response) => {
    res.status(403).type('text/plain').send('read-only repository');
  });

  // --------------------------------------------------------------------------
  // GET /vault.git/info/refs  (clone / fetch discovery)
  // --------------------------------------------------------------------------
  router.get('/info/refs', async (req: Request, res: Response) => {
    // Feature flag + bootstrap gate (req 1.4, 1.5)
    const ready = await assertGatewayReady(req, res);
    if (!ready) return;

    // Only git-upload-pack is supported (req 1.1 / Req 7)
    const { service } = req.query;
    if (service !== 'git-upload-pack') {
      res.status(400).send('Only git-upload-pack is supported');
      return;
    }

    // PAT authentication (req 2)
    let authResult: Awaited<ReturnType<VaultPatAuth['authenticate']>>;
    try {
      authResult = await auth.authenticate(req, res);
    } catch {
      // authenticate() already set status + WWW-Authenticate header.
      // Finalise the response (the authenticate() implementation sets the status
      // code and throws, but does not call res.end()).
      if (!res.headersSent) {
        res.status(401).end();
      } else {
        res.end();
      }
      // Log the auth failure to the audit log (req 10.4).
      createActivity?.({
        ip: req.ip,
        endpoint: req.originalUrl,
        action: SupportedAction.ACTION_VAULT_AUTH_FAILURE,
        user: undefined,
        snapshot: {},
      }).catch((err) =>
        logger.warn({ err }, 'Failed to record auth-failure activity'),
      );
      return;
    }

    const userId = authResult?.userId ?? null;
    const scopes = authResult?.scopes;

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
  });

  // --------------------------------------------------------------------------
  // POST /vault.git/git-upload-pack  (clone / fetch pack transfer)
  // --------------------------------------------------------------------------
  router.post('/git-upload-pack', async (req: Request, res: Response) => {
    // Feature flag + bootstrap gate (req 1.4, 1.5)
    const ready = await assertGatewayReady(req, res);
    if (!ready) return;

    // PAT authentication (req 2)
    let authResult: Awaited<ReturnType<VaultPatAuth['authenticate']>>;
    try {
      authResult = await auth.authenticate(req, res);
    } catch {
      if (!res.headersSent) {
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
      return;
    }

    const userId = authResult?.userId ?? null;
    const scopes = authResult?.scopes;

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
  });

  // --------------------------------------------------------------------------
  // Catch-all: any other /vault.git/* path → 404 (req 1.7)
  // --------------------------------------------------------------------------
  router.all('*', (_req: Request, res: Response) => {
    res.status(404).send('Not Found');
  });

  return router;
};
