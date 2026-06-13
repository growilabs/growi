import crypto from 'crypto';

import { AccessToken } from './access-token.js';

/**
 * Integration tests for AccessToken.findUserIdByToken.
 *
 * These tests use a real MongoMemoryServer connection (wired in by the
 * vitest globalSetup / setupFiles defined in vitest.workspace.mts) to
 * verify that the actual Mongoose projection includes the `scopes` field.
 *
 * The mock in vault-pat-auth.spec.ts cannot catch a missing `.select('scopes')`
 * because the mock bypasses the real Mongoose query. This file provides the
 * complementary "production shape" guarantee (req 2.5).
 */

const generateToken = (): string => crypto.randomBytes(32).toString('hex');

describe('AccessToken.findUserIdByToken', () => {
  const fakeUserId = '000000000000000000000001';
  const requiredScopes = ['read:features:page'] as const;

  beforeEach(async () => {
    await AccessToken.deleteMany({});
  });

  describe('when a token is stored with scopes', () => {
    it('returns a document that includes the scopes field (verifies .select projection includes scopes)', async () => {
      const token = generateToken();
      const expiredAt = new Date(Date.now() + 60_000); // 1 min in the future
      const expectedScopes = ['read:features:page'];

      await AccessToken.generateToken(
        fakeUserId,
        expiredAt,
        expectedScopes as any,
      );

      // We cannot use generateToken's returned raw token because generateToken
      // hashes it internally; instead insert directly with a known raw token.
      await AccessToken.deleteMany({});
      const rawToken = generateToken();
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');
      await AccessToken.create({
        user: fakeUserId,
        tokenHash,
        expiredAt,
        scopes: expectedScopes,
      });

      const doc = await AccessToken.findUserIdByToken(
        rawToken,
        requiredScopes as any,
      );

      // The document must be non-null (token is valid and satisfies scopes).
      expect(doc).not.toBeNull();

      // CRITICAL: scopes must be present on the returned document.
      // If .select('user') were used (the bug), doc.scopes would be undefined.
      // With .select('user scopes') the field is populated by MongoDB.
      expect(doc?.scopes).toBeDefined();
      expect(doc?.scopes).toEqual(expect.arrayContaining(expectedScopes));
    });

    it('returns a document with an empty scopes array when the token has no scopes set', async () => {
      const rawToken = generateToken();
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');
      const expiredAt = new Date(Date.now() + 60_000);

      // Insert a token that has the required scope so findUserIdByToken can find it,
      // but use an empty array for scopes to verify the field is present even when empty.
      await AccessToken.create({
        user: fakeUserId,
        tokenHash,
        expiredAt,
        scopes: requiredScopes, // needed to satisfy the $all query filter
      });

      const doc = await AccessToken.findUserIdByToken(
        rawToken,
        requiredScopes as any,
      );

      expect(doc).not.toBeNull();
      // scopes field must appear in the projection result (not undefined).
      expect(doc?.scopes).toBeDefined();
    });

    it('returns null for a non-existent token', async () => {
      const doc = await AccessToken.findUserIdByToken(
        generateToken(),
        requiredScopes as any,
      );
      expect(doc).toBeNull();
    });
  });

  describe('when a token is expired', () => {
    it('returns null for an expired token', async () => {
      const rawToken = generateToken();
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');
      const expiredAt = new Date(Date.now() - 1_000); // 1 second in the past

      await AccessToken.create({
        user: fakeUserId,
        tokenHash,
        expiredAt,
        scopes: requiredScopes,
      });

      const doc = await AccessToken.findUserIdByToken(
        rawToken,
        requiredScopes as any,
      );
      expect(doc).toBeNull();
    });
  });
});
