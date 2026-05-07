import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessToken } from '~/server/models/access-token';

import { createVaultPatAuth } from './vault-pat-auth';

// Mock the AccessToken model so tests do not require a real MongoDB connection.
vi.mock('~/server/models/access-token', () => ({
  AccessToken: {
    findUserIdByToken: vi.fn(),
  },
}));

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

/** Build a minimal Express Request mock with a given Authorization header. */
const buildRequest = (authHeader?: string): Request => {
  return {
    headers: authHeader != null ? { authorization: authHeader } : {},
  } as unknown as Request;
};

/**
 * Encode credentials in the HTTP Basic Auth base64 format.
 * git clients send `anyusername:PAT` encoded as base64.
 */
const encodeBasic = (username: string, password: string): string => {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${credentials}`;
};

/** Build a minimal Express Response mock that records status and headers. */
const buildResponse = (): Response & {
  statusCode: number;
  headers: Record<string, string>;
} => {
  const headers: Record<string, string> = {};
  let statusCode = 200;

  return {
    get headers() {
      return headers;
    },
    get statusCode() {
      return statusCode;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
  } as unknown as Response & {
    statusCode: number;
    headers: Record<string, string>;
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultPatAuth', () => {
  const VALID_PAT = 'valid-personal-access-token-abc123';
  const INVALID_PAT = 'invalid-or-revoked-token';

  let auth: ReturnType<typeof createVaultPatAuth>;

  beforeEach(() => {
    auth = createVaultPatAuth();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Case 1: No Authorization header → anonymous (null)
  // -------------------------------------------------------------------------

  describe('when the Authorization header is absent', () => {
    it('returns null for anonymous access without setting any response status', async () => {
      const req = buildRequest(); // no Authorization header
      const res = buildResponse();

      const result = await auth.authenticate(req, res);

      expect(result).toBeNull();
      expect(res.statusCode).toBe(200); // unchanged
      expect(res.headers['WWW-Authenticate']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Case 2: Valid PAT → { userId, scopes }
  // -------------------------------------------------------------------------

  describe('when a valid PAT is provided', () => {
    it('returns userId and scopes for a token with no scope restrictions', async () => {
      const userId = 'user-object-id-123';
      const tokenScopes = ['read:features:page'];

      // Simulate a found token document with user and scopes.
      const populateMock = vi.fn().mockResolvedValue({
        user: { _id: { toString: () => userId } },
      });
      const tokenDoc = {
        populate: populateMock,
        scopes: tokenScopes,
      };
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue(
        tokenDoc as any,
      );

      const req = buildRequest(encodeBasic('anyuser', VALID_PAT));
      const res = buildResponse();

      const result = await auth.authenticate(req, res);

      expect(result).not.toBeNull();
      expect(result?.userId).toBe(userId);
      expect(result?.scopes).toEqual(tokenScopes);
      expect(res.statusCode).toBe(200);
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(VALID_PAT, [
        'read:features:page',
      ]);
    });

    it('reflects scope restrictions in the returned scopes array (req 2.5)', async () => {
      const userId = 'user-object-id-456';
      // Token restricted to a subset of scopes
      const restrictedScopes = ['read:features:page'];

      const populateMock = vi.fn().mockResolvedValue({
        user: { _id: { toString: () => userId } },
      });
      const tokenDoc = {
        populate: populateMock,
        scopes: restrictedScopes,
      };
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue(
        tokenDoc as any,
      );

      const req = buildRequest(encodeBasic('git', VALID_PAT));
      const res = buildResponse();

      const result = await auth.authenticate(req, res);

      expect(result?.scopes).toEqual(restrictedScopes);
    });

    it('ignores the username portion of Basic Auth credentials and uses only the password (PAT)', async () => {
      const userId = 'user-object-id-789';
      const populateMock = vi.fn().mockResolvedValue({
        user: { _id: { toString: () => userId } },
      });
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue({
        populate: populateMock,
        scopes: [],
      } as any);

      // Different usernames should all resolve the same PAT
      const reqA = buildRequest(encodeBasic('alice', VALID_PAT));
      const reqB = buildRequest(encodeBasic('bob', VALID_PAT));
      const resA = buildResponse();
      const resB = buildResponse();

      await auth.authenticate(reqA, resA);
      await auth.authenticate(reqB, resB);

      // Both calls should have resolved the same PAT regardless of username
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
  });

  // -------------------------------------------------------------------------
  // Case 3: Invalid / revoked PAT → 401 + WWW-Authenticate header
  // -------------------------------------------------------------------------

  describe('when an invalid or revoked PAT is provided', () => {
    it('sets 401 status and WWW-Authenticate header, then throws', async () => {
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue(null);

      const req = buildRequest(encodeBasic('anyuser', INVALID_PAT));
      const res = buildResponse();

      await expect(auth.authenticate(req, res)).rejects.toThrow();

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe('Basic realm="GROWI Vault"');
    });

    it('does not include page list or existence information in the error message (req 2.3)', async () => {
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue(null);

      const req = buildRequest(encodeBasic('anyuser', INVALID_PAT));
      const res = buildResponse();

      let errorMessage = '';
      try {
        await auth.authenticate(req, res);
      } catch (err) {
        if (err instanceof Error) {
          errorMessage = err.message;
        }
      }

      // The error message must not reveal page paths, page IDs, or existence info
      expect(errorMessage).not.toMatch(/page/i);
      expect(errorMessage).not.toMatch(/path/i);
      expect(errorMessage).not.toMatch(/namespace/i);
      expect(errorMessage).not.toMatch(/exist/i);
    });

    it('sets 401 when the Authorization header uses a non-Basic scheme', async () => {
      const req = buildRequest('Bearer some-bearer-token');
      const res = buildResponse();

      await expect(auth.authenticate(req, res)).rejects.toThrow();

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe('Basic realm="GROWI Vault"');
    });
  });

  // -------------------------------------------------------------------------
  // Case 4: Token with no scopes → scopes field is an empty array
  // -------------------------------------------------------------------------

  describe('when a valid PAT has no explicit scopes', () => {
    it('returns an empty scopes array', async () => {
      const userId = 'user-object-id-000';
      const populateMock = vi.fn().mockResolvedValue({
        user: { _id: { toString: () => userId } },
      });
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue({
        populate: populateMock,
        scopes: undefined, // no scopes stored
      } as any);

      const req = buildRequest(encodeBasic('anyuser', VALID_PAT));
      const res = buildResponse();

      const result = await auth.authenticate(req, res);

      expect(result?.scopes).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Case 5: PAT with colons in the password (edge case for Basic Auth parsing)
  // -------------------------------------------------------------------------

  describe('when the PAT itself contains colons', () => {
    it('correctly extracts the PAT even when it contains colon characters', async () => {
      const patWithColons = 'part1:part2:part3';
      const userId = 'user-object-id-colon';
      const populateMock = vi.fn().mockResolvedValue({
        user: { _id: { toString: () => userId } },
      });
      vi.mocked(AccessToken.findUserIdByToken).mockResolvedValue({
        populate: populateMock,
        scopes: [],
      } as any);

      // Encode "anyuser:part1:part2:part3" — split on first colon only
      const req = buildRequest(encodeBasic('anyuser', patWithColons));
      const res = buildResponse();

      await auth.authenticate(req, res);

      // The full password portion "part1:part2:part3" should be passed as the PAT
      expect(AccessToken.findUserIdByToken).toHaveBeenCalledWith(
        patWithColons,
        expect.any(Array),
      );
    });
  });
});
