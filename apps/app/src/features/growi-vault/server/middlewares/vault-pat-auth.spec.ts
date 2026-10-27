import type { NextFunction, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessToken } from '~/server/models/access-token';

import {
  createVaultCredentialAdapter,
  type VaultAuthenticatedReq,
} from './vault-pat-auth';

// Mock the AccessToken model so tests do not require a real MongoDB connection.
// NOTE: This mock bypasses the real Mongoose query projection, so it cannot
// verify that .select('user scopes') is used. The production shape — i.e. that
// findUserIdByToken actually returns a document with the scopes field populated —
// is verified without mocks in src/server/models/access-token.integ.ts (task 20.2).
vi.mock('~/server/models/access-token', () => ({
  AccessToken: {
    findUserIdByToken: vi.fn(),
  },
}));

// serializeUserSecurely strips password/apiToken/email but preserves _id and
// status — both of which loginRequiredFactory inspects. We do not mock it so
// that the adapter's observable contract (req.user carries _id + status, no
// secrets) is exercised against the real serializer.

// Mock the logger to suppress log output during tests.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type VaultReq = VaultAuthenticatedReq;

/**
 * Build a minimal Express Request mock.
 *
 * `headers` lets a test set arbitrary headers (e.g. `x-growi-access-token`,
 * which is how a reverse proxy forwards the PAT — req 2.6). When `authHeader`
 * is given it is merged in as the `authorization` header.
 *
 * IMPORTANT: this intentionally leaves `query` and `body` UNSET (undefined),
 * matching the real `/vault.git/*` request shape — those routes have no body
 * parser because the POST handler streams `req` (the raw IncomingMessage)
 * straight to vault-manager and never touches `req.body`. The adapter must
 * tolerate this without throwing when it calls `extractAccessToken(req)`.
 */
const buildRequest = (
  authHeader?: string,
  headers: Record<string, string> = {},
): VaultReq => {
  const mergedHeaders: Record<string, string> = { ...headers };
  if (authHeader != null) {
    mergedHeaders.authorization = authHeader;
  }
  return {
    headers: mergedHeaders,
    ip: '127.0.0.1',
    originalUrl: '/vault.git/info/refs',
  } as unknown as VaultReq;
};

/**
 * Encode credentials in the HTTP Basic Auth base64 format.
 * git clients send `anyusername:PAT` encoded as base64.
 */
const encodeBasic = (username: string, password: string): string => {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${credentials}`;
};

/**
 * Build a minimal Express Response mock that records status, headers, and
 * whether the response was ended (finalised).
 */
const buildResponse = (): Response & {
  statusCode: number;
  headers: Record<string, string>;
  ended: boolean;
} => {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let ended = false;

  return {
    headersSent: false,
    get headers() {
      return headers;
    },
    get statusCode() {
      return statusCode;
    },
    get ended() {
      return ended;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    end() {
      ended = true;
      return this;
    },
  } as unknown as Response & {
    statusCode: number;
    headers: Record<string, string>;
    ended: boolean;
  };
};

/**
 * Stub a found AccessToken document whose populate('user') resolves the given
 * user. findUserIdByToken returns a document with a populate() method (mirrors
 * the real Mongoose document contract) plus the token's scopes.
 */
const stubFoundToken = (
  user: { _id: { toString(): string }; status?: number },
  scopes: ReadonlyArray<string>,
) => {
  const populateMock = vi.fn().mockResolvedValue({ user });
  vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue({
    populate: populateMock,
    scopes,
    // biome-ignore lint/suspicious/noExplicitAny: Mongoose HydratedDocument shape is not reconstructible here
  } as any);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('vault credential adapter (seam #1)', () => {
  const VALID_PAT = 'valid-personal-access-token-abc123';
  const INVALID_PAT = 'invalid-or-revoked-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // No Authorization header → anonymous candidate (req.user stays null)
  // -------------------------------------------------------------------------

  describe('when the Authorization header is absent', () => {
    it('leaves req.user unset and calls next() (guest decision deferred to loginRequired)', async () => {
      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(); // no Authorization header
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeUndefined();
      expect(res.statusCode).toBe(200); // untouched
      expect(res.ended).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Valid PAT → req.user populated (with _id + status), scopes stashed
  // -------------------------------------------------------------------------

  describe('when a valid PAT is provided', () => {
    it('populates req.user with an ACTIVE user (id + status preserved) and stashes scopes, then calls next()', async () => {
      const userId = 'user-object-id-123';
      const tokenScopes = ['read:features:page'];
      stubFoundToken(
        { _id: { toString: () => userId }, status: 2 /* STATUS_ACTIVE */ },
        tokenScopes,
      );

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('anyuser', VALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      // loginRequiredFactory inspects req.user._id and req.user.status.
      const resolved = req.user as { _id: unknown; status: number };
      expect(resolved).not.toBeNull();
      expect(String((resolved as { _id: { toString(): string } })._id)).toBe(
        userId,
      );
      expect(resolved.status).toBe(2);
      // Scopes are stashed for the handler to forward to namespace computation.
      expect(req.vaultScopes).toEqual(tokenScopes);
      // No challenge / rejection.
      expect(res.ended).toBe(false);
      expect(res.headers['WWW-Authenticate']).toBeUndefined();
      // The PAT password (not the username) is validated.
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(VALID_PAT, [
        'read:features:page',
      ]);
    });

    it('does not leak secret attributes (password/apiToken) onto req.user', async () => {
      const userId = 'user-object-id-secret';
      stubFoundToken(
        {
          _id: { toString: () => userId },
          status: 2,
          // biome-ignore lint/suspicious/noExplicitAny: simulating a raw user doc with secrets
        } as any,
        [],
      );
      // Inject secret fields the serializer must strip.
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue({
        populate: vi.fn().mockResolvedValue({
          user: {
            _id: { toString: () => userId },
            status: 2,
            password: 'hashed-secret',
            apiToken: 'api-secret',
          },
        }),
        scopes: [],
        // biome-ignore lint/suspicious/noExplicitAny: Mongoose HydratedDocument shape
      } as any);

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('anyuser', VALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      const resolved = req.user as Record<string, unknown>;
      expect(resolved.password).toBeUndefined();
      expect(resolved.apiToken).toBeUndefined();
    });

    it('reflects scope restrictions in req.vaultScopes (req 2.5)', async () => {
      const restrictedScopes = ['read:features:page'];
      stubFoundToken(
        { _id: { toString: () => 'u' }, status: 2 },
        restrictedScopes,
      );

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('git', VALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(req.vaultScopes).toEqual(restrictedScopes);
    });

    it('ignores the username portion of Basic Auth and uses only the password (PAT)', async () => {
      stubFoundToken({ _id: { toString: () => 'u' }, status: 2 }, []);

      const adapter = createVaultCredentialAdapter();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(
        buildRequest(encodeBasic('alice', VALID_PAT)),
        buildResponse(),
        next,
      );
      await adapter(
        buildRequest(encodeBasic('bob', VALID_PAT)),
        buildResponse(),
        next,
      );

      expect(AccessToken.findUserIdByToken).toHaveBeenNthCalledWith(
        1,
        VALID_PAT,
        expect.any(Array),
      );
      expect(AccessToken.findUserIdByToken).toHaveBeenNthCalledWith(
        2,
        VALID_PAT,
        expect.any(Array),
      );
    });

    it('correctly extracts a PAT that itself contains colon characters', async () => {
      const patWithColons = 'part1:part2:part3';
      stubFoundToken({ _id: { toString: () => 'u' }, status: 2 }, []);

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('anyuser', patWithColons));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(
        patWithColons,
        expect.any(Array),
      );
    });

    it('allows a read-only user (vault clone is read-only — intentional deviation from accessTokenParser)', async () => {
      // The standard parserForAccessToken rejects readOnly users; the vault
      // credential adapter intentionally does NOT, so read-only users can clone.
      stubFoundToken(
        {
          _id: { toString: () => 'ro-user' },
          status: 2,
          // biome-ignore lint/suspicious/noExplicitAny: readOnly is not on the minimal stub type
        } as any,
        [],
      );
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue({
        populate: vi.fn().mockResolvedValue({
          user: {
            _id: { toString: () => 'ro-user' },
            status: 2,
            readOnly: true,
          },
        }),
        scopes: [],
        // biome-ignore lint/suspicious/noExplicitAny: Mongoose HydratedDocument shape
      } as any);

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('anyuser', VALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      // Resolved, not rejected.
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).not.toBeNull();
      expect(res.ended).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Present-but-invalid / revoked / expired PAT → 401 + WWW-Authenticate + END
  // (req 2.2 — loginRequiredFactory alone cannot do this: it would treat a
  // missing user as anonymous and allow it when guests are permitted.)
  // -------------------------------------------------------------------------

  describe('when a present credential is invalid / revoked / expired', () => {
    it('responds 401 + WWW-Authenticate, ends the response, and does NOT call next()', async () => {
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue(null);

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('anyuser', INVALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe('Basic realm="GROWI Vault"');
      expect(res.ended).toBe(true);
      // MUST NOT fall through to anonymous handling.
      expect(next).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('records a VAULT_AUTH_FAILURE audit event when a present credential is invalid (req 10.4)', async () => {
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue(null);
      const createActivity = vi.fn().mockResolvedValue(undefined);

      const adapter = createVaultCredentialAdapter(createActivity);
      const req = buildRequest(encodeBasic('anyuser', INVALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VAULT_AUTH_FAILURE' }),
      );
    });

    it('rejects a non-Basic Authorization scheme with 401 (fail-closed)', async () => {
      const adapter = createVaultCredentialAdapter();
      const req = buildRequest('Bearer some-bearer-token');
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe('Basic realm="GROWI Vault"');
      expect(next).not.toHaveBeenCalled();
    });

    it('does not include page/path/existence information in the rejection (req 2.3)', async () => {
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue(null);

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('anyuser', INVALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      // The challenge body is empty (.end() with no payload); only the
      // WWW-Authenticate header is emitted.
      expect(res.headers['WWW-Authenticate']).toBe('Basic realm="GROWI Vault"');
    });
  });

  // -------------------------------------------------------------------------
  // Token with no scopes → vaultScopes is an empty array
  // -------------------------------------------------------------------------

  describe('when a valid PAT has no explicit scopes', () => {
    it('stashes an empty scopes array', async () => {
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue({
        populate: vi.fn().mockResolvedValue({
          user: { _id: { toString: () => 'u' }, status: 2 },
        }),
        scopes: undefined,
        // biome-ignore lint/suspicious/noExplicitAny: Mongoose HydratedDocument shape
      } as any);

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('anyuser', VALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(req.vaultScopes).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Reverse-proxy coexistence: PAT resolution shares the standard
  // `extractAccessToken` precedence (Bearer > X-GROWI-ACCESS-TOKEN > query >
  // body) with the git-native `Authorization: Basic` password as a fallback
  // (req 2.6).
  // -------------------------------------------------------------------------

  describe('reverse-proxy coexistence (req 2.6)', () => {
    const PROXY_PASS = 'reverse-proxy-basic-password';

    /**
     * Recognise only `VALID_PAT`; reject every other raw token. This lets the
     * tests prove WHICH credential was extracted and validated (the observable
     * contract) rather than spying on the extraction mechanism.
     */
    const recogniseOnlyValidPat = () => {
      vi.mocked(AccessToken.findUserIdByToken).mockImplementation(
        (rawToken: string) => {
          if (rawToken !== VALID_PAT) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            populate: vi.fn().mockResolvedValue({
              user: { _id: { toString: () => 'u' }, status: 2 },
            }),
            scopes: ['read:features:page'],
            // biome-ignore lint/suspicious/noExplicitAny: Mongoose HydratedDocument shape
          } as any);
        },
      );
    };

    it('authenticates a PAT delivered via the X-GROWI-ACCESS-TOKEN header (no Authorization)', async () => {
      recogniseOnlyValidPat();

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(undefined, {
        'x-growi-access-token': VALID_PAT,
      });
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).not.toBeUndefined();
      expect(res.ended).toBe(false);
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(VALID_PAT, [
        'read:features:page',
      ]);
    });

    it('still authenticates the git-native Authorization: Basic base64(x:PAT) (no proxy — regression)', async () => {
      recogniseOnlyValidPat();

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('x', VALID_PAT));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).not.toBeUndefined();
      expect(res.ended).toBe(false);
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(VALID_PAT, [
        'read:features:page',
      ]);
    });

    it('fails closed (401) when only a reverse-proxy Basic credential is present and its password is NOT a valid PAT', async () => {
      // Behind a Basic-auth proxy WITHOUT the X-GROWI-ACCESS-TOKEN extraHeader:
      // the Basic fallback extracts the proxy password, validation fails, and
      // the adapter MUST reject rather than silently degrade to anonymous.
      recogniseOnlyValidPat();

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('proxyUser', PROXY_PASS));
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe('Basic realm="GROWI Vault"');
      expect(res.ended).toBe(true);
      expect(next).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('prefers the X-GROWI-ACCESS-TOKEN header over Authorization: Basic when both are present', async () => {
      // Reverse-proxy scenario: the proxy injects its own Basic credential AND
      // forwards the PAT via the extraHeader. extractAccessToken precedence puts
      // the X-GROWI header ahead of the Basic fallback, so the PAT authenticates.
      recogniseOnlyValidPat();

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(encodeBasic('proxyUser', PROXY_PASS), {
        'x-growi-access-token': VALID_PAT,
      });
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).not.toBeUndefined();
      // The proxy password (Basic fallback) was never validated; the X-GROWI PAT was.
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledTimes(1);
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(VALID_PAT, [
        'read:features:page',
      ]);
    });

    it('prefers a Bearer token over the X-GROWI-ACCESS-TOKEN header (extractAccessToken precedence)', async () => {
      recogniseOnlyValidPat();

      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(`Bearer ${VALID_PAT}`, {
        'x-growi-access-token': 'some-other-token',
      });
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      await adapter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).not.toBeUndefined();
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(VALID_PAT, [
        'read:features:page',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Runtime guard: /vault.git/* requests have no body parser, so req.body is
  // undefined. extractAccessToken dereferences req.body.access_token last in
  // its ?? chain, so the adapter must guard against the undefined body for the
  // common anonymous / Basic-only paths (it must not throw).
  // -------------------------------------------------------------------------

  describe('when the request has no body parser (req.body undefined)', () => {
    it('treats an anonymous request as anonymous without throwing', async () => {
      const adapter = createVaultCredentialAdapter();
      const req = buildRequest(); // no Authorization, no X-GROWI header, undefined body
      const res = buildResponse();
      const next = vi.fn() as unknown as NextFunction;

      // Must not throw "Cannot read properties of undefined (reading 'access_token')".
      await expect(adapter(req, res, next)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeUndefined();
      expect(res.ended).toBe(false);
    });
  });
});
