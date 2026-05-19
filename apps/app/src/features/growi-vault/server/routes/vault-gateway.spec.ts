import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// ---------------------------------------------------------------------------
// Import mocked modules so tests can configure them
// ---------------------------------------------------------------------------

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
  app.use('/_vault/repo.git', createVaultGatewayRouter(deps));
  return app;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultGatewayRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Feature flag gate
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
        '/_vault/repo.git/info/refs?service=git-upload-pack',
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
      const res = await request(app).post('/_vault/repo.git/git-upload-pack');

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
        '/_vault/repo.git/info/refs?service=git-upload-pack',
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
      const res = await request(app).post('/_vault/repo.git/git-upload-pack');

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
        '/_vault/repo.git/info/refs?service=git-upload-pack',
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
        '/_vault/repo.git/info/refs?service=git-upload-pack',
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
        '/_vault/repo.git/info/refs?service=git-upload-pack',
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
        '/_vault/repo.git/info/refs?service=git-upload-pack',
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
        '/_vault/repo.git/info/refs?service=git-upload-pack',
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
      const res = await request(app).get('/_vault/repo.git/git-receive-pack');

      expect(res.status).toBe(403);
      expect(res.text).toContain('read-only repository');
    });

    it('returns 403 for POST git-receive-pack', async () => {
      const app = buildApp();
      const res = await request(app).post('/_vault/repo.git/git-receive-pack');

      expect(res.status).toBe(403);
      expect(res.text).toContain('read-only repository');
    });
  });

  // -------------------------------------------------------------------------
  // Authentication failure
  // -------------------------------------------------------------------------

  describe('when authentication fails', () => {
    it('returns 401 + WWW-Authenticate and does not include page information', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      mockSyncStateDone();

      // Provide a PAT auth stub that rejects with 401
      const failingAuth = {
        authenticate: vi.fn().mockImplementation((_req, res) => {
          res.setHeader('WWW-Authenticate', 'Basic realm="GROWI Vault"');
          res.status(401);
          throw new Error('Unauthorized');
        }),
      };

      const app = buildApp({ vaultPatAuth: failingAuth });
      const res = await request(app).get(
        '/_vault/repo.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Basic realm="GROWI Vault"');

      // The body must NOT expose page names, paths, or existence information (req 2.3)
      expect(res.text).not.toMatch(/\/|page|path|exist/i);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown service parameter
  // -------------------------------------------------------------------------

  describe('GET /info/refs with non-upload-pack service', () => {
    it('returns 400', async () => {
      (
        vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
      ).mockResolvedValue(enabledSettings);
      mockSyncStateDone();

      const successfulAuth = {
        authenticate: vi
          .fn()
          .mockResolvedValue({ userId: 'user1', scopes: [] }),
      };

      const app = buildApp({ vaultPatAuth: successfulAuth });
      const res = await request(app).get(
        '/_vault/repo.git/info/refs?service=git-receive-pack',
      );

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path: normal clone sequence
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

      const successfulAuth = {
        authenticate: vi
          .fn()
          .mockResolvedValue({ userId: mockUserId, scopes: [] }),
      };
      const createActivity = vi.fn().mockResolvedValue(undefined);

      const app = buildApp({ vaultPatAuth: successfulAuth, createActivity });
      const res = await request(app).get(
        '/_vault/repo.git/info/refs?service=git-upload-pack',
      );

      expect(res.status).toBe(200);

      // composeView must be called with the resolved userId and namespaces
      expect(vaultManagerClient.composeView).toHaveBeenCalledWith({
        userId: mockUserId,
        namespaces: mockNamespaces,
      });

      // proxyGitRequest must be called with the correct path and viewRef
      expect(vaultManagerClient.proxyGitRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/internal/git/info/refs',
          viewRef: mockViewRef,
        }),
      );

      // Audit log entry for clone-prepare must be created
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
      const successfulAuth = {
        authenticate: vi
          .fn()
          .mockResolvedValue({ userId: mockUserId, scopes: mockScopes }),
      };

      const app = buildApp({ vaultPatAuth: successfulAuth });
      await request(app).get(
        '/_vault/repo.git/info/refs?service=git-upload-pack',
      );

      // computeAccessibleNamespaces must be called with both userId and scopes
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

      const successfulAuth = {
        authenticate: vi
          .fn()
          .mockResolvedValue({ userId: mockUserId, scopes: [] }),
      };
      const createActivity = vi.fn().mockResolvedValue(undefined);

      const app = buildApp({ vaultPatAuth: successfulAuth, createActivity });
      const res = await request(app)
        .post('/_vault/repo.git/git-upload-pack')
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

      // Audit log entry for clone-complete must be created
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
      const successfulAuth = {
        authenticate: vi
          .fn()
          .mockResolvedValue({ userId: mockUserId, scopes: mockScopes }),
      };

      const app = buildApp({ vaultPatAuth: successfulAuth });
      await request(app)
        .post('/_vault/repo.git/git-upload-pack')
        .set('Content-Type', 'application/x-git-upload-pack-request')
        .send(Buffer.from('0011want abc\n0000'));

      // computeAccessibleNamespaces must be called with both userId and scopes
      expect(
        vaultNamespaceMapper.computeAccessibleNamespaces,
      ).toHaveBeenCalledWith(mockUserId, mockScopes);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown paths
  // -------------------------------------------------------------------------

  describe('unknown /_vault/repo.git/* paths', () => {
    it('returns 404 for GET /HEAD', async () => {
      const app = buildApp();
      const res = await request(app).get('/_vault/repo.git/HEAD');

      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /objects/info/packs', async () => {
      const app = buildApp();
      const res = await request(app).get('/_vault/repo.git/objects/info/packs');

      expect(res.status).toBe(404);
    });
  });
});
