import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { createVaultGatewayRouter } from './vault-gateway';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../models/vault-sync-state', () => ({
  VaultSyncState: {
    findById: vi.fn(),
  },
}));

vi.mock('../services/vault-settings-service', () => ({
  vaultSettingsService: {
    getSettings: vi.fn(),
  },
}));

vi.mock('../services/vault-namespace-mapper', () => ({
  vaultNamespaceMapper: {
    computeAccessibleNamespaces: vi.fn(),
  },
}));

vi.mock('../services/vault-manager-client', () => ({
  vaultManagerClient: {
    composeView: vi.fn(),
    proxyGitRequest: vi.fn(),
  },
}));

// IMPORTANT: loginRequiredFactory is intentionally NOT mocked. The
// user-required decision MUST run through the real standard middleware so the
// gateway shares the single source of truth instead of re-implementing authz
// (req 11). The crowi stub drives the inputs.

// ---------------------------------------------------------------------------
// Import mocked modules so tests can configure them
// ---------------------------------------------------------------------------

import { VaultSyncState } from '../models/vault-sync-state';
import { vaultManagerClient } from '../services/vault-manager-client';
import { vaultNamespaceMapper } from '../services/vault-namespace-mapper';
import { vaultSettingsService } from '../services/vault-settings-service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal Express app that mounts the vault gateway router. */
function buildApp(deps: Parameters<typeof createVaultGatewayRouter>[0] = {}) {
  const app = express();
  app.use('/vault.git', createVaultGatewayRouter(deps));
  return app;
}

/**
 * Build a crowi stub that drives the REAL loginRequiredFactory and
 * maintenance-mode middleware. Guests may read, so a credential-less request
 * is refused only because the gateway does not admit guests.
 */
function buildCrowi(opts: { isMaintenanceMode?: boolean } = {}) {
  return mock<Crowi>({
    aclService: {
      isGuestAllowedToRead: vi.fn().mockReturnValue(true),
    },
    appService: {
      isMaintenanceMode: vi
        .fn()
        .mockReturnValue(opts.isMaintenanceMode ?? false),
    },
  });
}

/** Make VaultSyncState.findById return a singleton with bootstrapState=done. */
function mockSyncStateDone() {
  (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
    lean: vi.fn().mockResolvedValue({ bootstrapState: 'done' }),
  });
}

/** Settings fixture with vault enabled. */
const enabledSettings = {
  enabled: true,
  managerEndpoint: 'http://vault-manager',
  managerInternalSecret: 'secret',
};

/** A valid git-upload-pack-advertisement stream. */
function makePackStream() {
  return Readable.from(['# service=git-upload-pack\n0000']);
}

/** Default successful proxy response. */
function makeProxyOkResponse(contentType: string) {
  return {
    status: 200,
    headers: { 'content-type': contentType },
    body: makePackStream(),
  };
}

/**
 * A credential-adapter middleware stub that resolves an authenticated user.
 * Mirrors the real adapter: populates req.user (with _id + ACTIVE status) and
 * stashes req.vaultScopes, then calls next().
 */
function authedAdapter(userId: string, scopes: ReadonlyArray<string> = []) {
  // biome-ignore lint/suspicious/noExplicitAny: minimal Express middleware stub
  return (req: any, _res: any, next: any) => {
    req.user = { _id: userId, status: 2 /* STATUS_ACTIVE */ };
    req.vaultScopes = scopes;
    next();
  };
}

/** A credential-adapter middleware stub that resolves no user (no credential presented). */
// biome-ignore lint/suspicious/noExplicitAny: minimal Express middleware stub
function noCredentialAdapter(_req: any, _res: any, next: any) {
  next();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultGatewayRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Feature flag gate (no crowi needed — gate runs before auth middleware)
  // -------------------------------------------------------------------------

  describe('when vaultEnabled=false', () => {
    it('returns 404 for GET info/refs (feature is disabled, not transient unavailability)', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ...enabledSettings,
        enabled: false,
      });

      const app = buildApp();
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(404);
      // Must not emit Retry-After — disabled is not a transient state
      expect(res.headers['retry-after']).toBeUndefined();
    });

    it('returns 404 for POST git-upload-pack (feature is disabled, not transient unavailability)', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ...enabledSettings,
        enabled: false,
      });

      const app = buildApp();
      const res = await request(app).post('/vault.git/git-upload-pack');

      expect(res.status).toBe(404);
      expect(res.headers['retry-after']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Bootstrap state gate
  // -------------------------------------------------------------------------

  describe('when bootstrapState !== done', () => {
    it('returns 503 + Retry-After for GET info/refs when bootstrapState=running', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'running' }),
      });

      const app = buildApp();
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('60');
    });

    it('returns 503 without Retry-After for POST git-upload-pack when bootstrapState=pending', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'pending' }),
      });

      const app = buildApp();
      const res = await request(app).post('/vault.git/git-upload-pack');

      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBeUndefined();
    });

    it('returns 503 with "has not been initialised" message when bootstrapState=pending', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'pending' }),
      });

      const app = buildApp();
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(503);
      expect(res.text).toContain('has not been initialised');
    });

    it('returns 503 with "initialising (bootstrap in progress)" message when bootstrapState=running', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'running' }),
      });

      const app = buildApp();
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(503);
      expect(res.text).toContain('initialising (bootstrap in progress)');
    });

    it('returns 503 with "initialisation failed" message when bootstrapState=failed', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'failed' }),
      });

      const app = buildApp();
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(503);
      expect(res.text).toContain('initialisation failed');
    });

    it('returns 503 without Retry-After when bootstrapState=failed', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'failed' }),
      });

      const app = buildApp();
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBeUndefined();
    });

    it('does not include page list or existence information in 503 body (req 1.5 security)', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'pending' }),
      });

      const app = buildApp();
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(503);
      // Must not expose page names, page paths, or existence information (req 1.5 security)
      // Note: admin UI paths like /admin/vault are allowed; only wiki page paths are restricted
      expect(res.text).not.toMatch(
        /page.*list|pages exist|\/wiki|page not found/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Push rejection
  // -------------------------------------------------------------------------

  describe('ANY git-receive-pack', () => {
    it('returns 403 for GET git-receive-pack', async () => {
      const app = buildApp();
      const res = await request(app).get('/vault.git/git-receive-pack');

      expect(res.status).toBe(403);
      expect(res.text).toContain('read-only repository');
    });

    it('returns 403 for POST git-receive-pack', async () => {
      const app = buildApp();
      const res = await request(app).post('/vault.git/git-receive-pack');

      expect(res.status).toBe(403);
      expect(res.text).toContain('read-only repository');
    });
  });

  // -------------------------------------------------------------------------
  // Maintenance mode (req 11 — standard middleware applied to the gateway)
  // -------------------------------------------------------------------------

  describe('standard middleware chain: maintenance mode', () => {
    it('returns 503 when crowi.appService.isMaintenanceMode() is true (ForApi variant)', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      mockSyncStateDone();

      const crowi = buildCrowi({ isMaintenanceMode: true });

      const app = buildApp({ crowi, vaultPatAuth: authedAdapter('u') });
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      // ForApi variant returns a 503 (not an HTML render) — appropriate for git.
      expect(res.status).toBe(503);
      // The request must not have reached namespace computation / proxying.
      expect(
        vaultNamespaceMapper.computeAccessibleNamespaces,
      ).not.toHaveBeenCalled();
      expect(vaultManagerClient.composeView).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Credential-less request via the REAL loginRequiredFactory (req 2.4 / 11)
  // -------------------------------------------------------------------------

  describe('standard middleware chain: request without a credential', () => {
    beforeEach(() => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      // A request let through would get the 503 readiness answer, so a 401
      // shows it was refused before the gateway looked at its own state.
      (VaultSyncState.findById as ReturnType<typeof vi.fn>).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ bootstrapState: 'pending' }),
      });
    });

    it('GET /info/refs returns 401 + WWW-Authenticate before any namespace or view work', async () => {
      const createActivity = vi.fn().mockResolvedValue(undefined);
      const app = buildApp({
        crowi: buildCrowi(),
        vaultPatAuth: noCredentialAdapter,
        createActivity,
      });

      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Basic realm="GROWI Vault"');
      expect(
        vaultNamespaceMapper.computeAccessibleNamespaces,
      ).not.toHaveBeenCalled();
      expect(vaultManagerClient.composeView).not.toHaveBeenCalled();
      expect(vaultManagerClient.proxyGitRequest).not.toHaveBeenCalled();
      expect(createActivity).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          action: 'VAULT_AUTH_FAILURE',
          endpoint: '/vault.git/info/refs?service=git-upload-pack',
        }),
      );
    });

    it('POST /git-upload-pack returns 401 + WWW-Authenticate before any namespace or view work', async () => {
      const createActivity = vi.fn().mockResolvedValue(undefined);
      const app = buildApp({
        crowi: buildCrowi(),
        vaultPatAuth: noCredentialAdapter,
        createActivity,
      });

      const res = await request(app)
        .post('/vault.git/git-upload-pack')
        .set('Content-Type', 'application/x-git-upload-pack-request')
        .send(Buffer.from('0011want abc\n0000'));

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Basic realm="GROWI Vault"');
      expect(
        vaultNamespaceMapper.computeAccessibleNamespaces,
      ).not.toHaveBeenCalled();
      expect(vaultManagerClient.composeView).not.toHaveBeenCalled();
      expect(vaultManagerClient.proxyGitRequest).not.toHaveBeenCalled();
      expect(createActivity).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          action: 'VAULT_AUTH_FAILURE',
          endpoint: '/vault.git/git-upload-pack',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Unknown service parameter (auth passes first via authed adapter)
  // -------------------------------------------------------------------------

  describe('GET /info/refs with non-upload-pack service', () => {
    it('returns 400', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      mockSyncStateDone();

      const crowi = buildCrowi();
      const app = buildApp({ crowi, vaultPatAuth: authedAdapter('user1') });
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-receive-pack',
      );

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path: normal clone sequence (authenticated)
  // -------------------------------------------------------------------------

  describe('successful clone sequence', () => {
    const mockUserId = 'user-abc';
    const mockViewRef = 'user-abc-view';
    const mockNamespaces = ['public', 'group-eng'];

    beforeEach(() => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      mockSyncStateDone();
      (
        vaultNamespaceMapper.computeAccessibleNamespaces as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(mockNamespaces);
      (
        vaultManagerClient.composeView as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        viewRef: mockViewRef,
        commitOid: 'abc123',
      });
    });

    it('GET /info/refs calls composeView and proxyGitRequest, returns 200', async () => {
      (
        vaultManagerClient.proxyGitRequest as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        makeProxyOkResponse('application/x-git-upload-pack-advertisement'),
      );

      const crowi = buildCrowi();
      const createActivity = vi.fn().mockResolvedValue(undefined);

      const app = buildApp({
        crowi,
        vaultPatAuth: authedAdapter(mockUserId),
        createActivity,
      });
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(200);
      expect(vaultManagerClient.composeView).toHaveBeenCalledWith({
        userId: mockUserId,
        namespaces: mockNamespaces,
      });
      expect(vaultManagerClient.proxyGitRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/internal/git/info/refs',
          viewRef: mockViewRef,
        }),
      );
      expect(createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VAULT_CLONE_PREPARE' }),
      );
    });

    it('GET /info/refs propagates PAT scopes to computeAccessibleNamespaces (req 2.5)', async () => {
      (
        vaultManagerClient.proxyGitRequest as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        makeProxyOkResponse('application/x-git-upload-pack-advertisement'),
      );

      const mockScopes = ['read:features:page'];
      const crowi = buildCrowi();
      const app = buildApp({
        crowi,
        vaultPatAuth: authedAdapter(mockUserId, mockScopes),
      });
      await request(app).get('/vault.git/info/refs?service=git-upload-pack');

      expect(
        vaultNamespaceMapper.computeAccessibleNamespaces,
      ).toHaveBeenCalledWith(mockUserId, mockScopes);
    });

    it('POST /git-upload-pack calls composeView and proxyGitRequest, returns 200', async () => {
      (
        vaultManagerClient.proxyGitRequest as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        makeProxyOkResponse('application/x-git-upload-pack-result'),
      );

      const crowi = buildCrowi();
      const createActivity = vi.fn().mockResolvedValue(undefined);

      const app = buildApp({
        crowi,
        vaultPatAuth: authedAdapter(mockUserId),
        createActivity,
      });
      const res = await request(app)
        .post('/vault.git/git-upload-pack')
        .set('Content-Type', 'application/x-git-upload-pack-request')
        .send(Buffer.from('0011want abc\n0000'));

      expect(res.status).toBe(200);
      expect(vaultManagerClient.composeView).toHaveBeenCalledWith({
        userId: mockUserId,
        namespaces: mockNamespaces,
      });
      expect(vaultManagerClient.proxyGitRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/internal/git/git-upload-pack',
          viewRef: mockViewRef,
        }),
      );
      expect(createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VAULT_CLONE_COMPLETE' }),
      );
    });

    it('POST /git-upload-pack propagates PAT scopes to computeAccessibleNamespaces (req 2.5)', async () => {
      (
        vaultManagerClient.proxyGitRequest as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        makeProxyOkResponse('application/x-git-upload-pack-result'),
      );

      const mockScopes = ['read:features:page'];
      const crowi = buildCrowi();
      const app = buildApp({
        crowi,
        vaultPatAuth: authedAdapter(mockUserId, mockScopes),
      });
      await request(app)
        .post('/vault.git/git-upload-pack')
        .set('Content-Type', 'application/x-git-upload-pack-request')
        .send(Buffer.from('0011want abc\n0000'));

      expect(
        vaultNamespaceMapper.computeAccessibleNamespaces,
      ).toHaveBeenCalledWith(mockUserId, mockScopes);
    });
  });

  // -------------------------------------------------------------------------
  // crowi omitted (as the vault E2E fixture mounts it): only the credential
  // adapter runs in front of the handlers
  // -------------------------------------------------------------------------

  describe('when crowi is omitted (no maintenance / loginRequired middleware)', () => {
    it('refuses a request without a credential with 401 and never reaches namespace computation', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      mockSyncStateDone();
      const createActivity = vi.fn().mockResolvedValue(undefined);

      const app = buildApp({
        vaultPatAuth: noCredentialAdapter,
        createActivity,
      });
      const infoRefs = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );
      const uploadPack = await request(app)
        .post('/vault.git/git-upload-pack')
        .set('Content-Type', 'application/x-git-upload-pack-request')
        .send(Buffer.from('0011want abc\n0000'));

      for (const res of [infoRefs, uploadPack]) {
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toBe(
          'Basic realm="GROWI Vault"',
        );
      }
      expect(
        vaultNamespaceMapper.computeAccessibleNamespaces,
      ).not.toHaveBeenCalled();
      expect(vaultManagerClient.composeView).not.toHaveBeenCalled();
      expect(vaultManagerClient.proxyGitRequest).not.toHaveBeenCalled();
      expect(createActivity.mock.calls).toEqual(
        [
          '/vault.git/info/refs?service=git-upload-pack',
          '/vault.git/git-upload-pack',
        ].map((endpoint) => [
          expect.objectContaining({ action: 'VAULT_AUTH_FAILURE', endpoint }),
        ]),
      );
    });

    it('GET /info/refs proceeds without maintenance/loginRequired when crowi is not provided', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      mockSyncStateDone();
      (
        vaultNamespaceMapper.computeAccessibleNamespaces as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(['public']);
      (
        vaultManagerClient.composeView as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ viewRef: 'v', commitOid: 'abc' });
      (
        vaultManagerClient.proxyGitRequest as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        makeProxyOkResponse('application/x-git-upload-pack-advertisement'),
      );

      // No crowi → no maintenance/loginRequired; the authed adapter resolves a user.
      const app = buildApp({ vaultPatAuth: authedAdapter('user-x') });
      const res = await request(app).get(
        '/vault.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(200);
      expect(vaultManagerClient.composeView).toHaveBeenCalledWith({
        userId: 'user-x',
        namespaces: ['public'],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Unknown paths
  // -------------------------------------------------------------------------

  describe('unknown /vault.git/* paths', () => {
    it('returns 404 for GET /HEAD', async () => {
      const app = buildApp();
      const res = await request(app).get('/vault.git/HEAD');

      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /objects/info/packs', async () => {
      const app = buildApp();
      const res = await request(app).get('/vault.git/objects/info/packs');

      expect(res.status).toBe(404);
    });
  });
});
