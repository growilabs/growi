import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatOAuthInstallState } from './models/chat-oauth-install-state';
import {
  issueOAuthInstallState,
  verifyOAuthInstallState,
} from './oauth-install-state-service';

const ADMIN_ID = new Types.ObjectId();

describe('oauth-install-state-service', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_oauth_install_state',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatOAuthInstallState.deleteMany({});
  });

  describe('issueOAuthInstallState', () => {
    it('issues a fresh, unpredictable state each call -- never the same value twice', async () => {
      const first = await issueOAuthInstallState(ADMIN_ID, 'slack');
      const second = await issueOAuthInstallState(ADMIN_ID, 'slack');

      expect(first.state).not.toBe(second.state);
      // Long enough that guessing it is infeasible (32 random bytes, hex-encoded).
      expect(first.state.length).toBeGreaterThanOrEqual(64);
    });

    it('stores an expiry shorter than the account-link order window (10 minutes)', async () => {
      const before = Date.now();
      const issued = await issueOAuthInstallState(ADMIN_ID, 'slack');

      expect(issued.expiresAt.getTime() - before).toBeLessThan(10 * 60_000);
      expect(issued.expiresAt.getTime()).toBeGreaterThan(before);
    });
  });

  describe('verifyOAuthInstallState', () => {
    it('accepts a valid, unexpired, previously-issued state and reports its platform', async () => {
      const issued = await issueOAuthInstallState(ADMIN_ID, 'discord');

      const result = await verifyOAuthInstallState(issued.state);

      expect(result).toMatchObject({ ok: true, platform: 'discord' });
    });

    it('refuses an empty state without needing a matching record', async () => {
      const result = await verifyOAuthInstallState('');

      expect(result).toEqual({ ok: false, reason: 'empty' });
    });

    it('refuses a state that was never issued', async () => {
      const result = await verifyOAuthInstallState('never-issued-state');

      expect(result).toEqual({ ok: false, reason: 'unknown' });
    });

    it('refuses an expired state', async () => {
      const issued = await issueOAuthInstallState(ADMIN_ID, 'slack');
      await ChatOAuthInstallState.updateOne(
        { state: issued.state },
        { expiresAt: new Date(Date.now() - 1000) },
      );

      const result = await verifyOAuthInstallState(issued.state);

      expect(result).toEqual({ ok: false, reason: 'expired' });
    });

    it('refuses a state that was already consumed by an earlier verify call (one-time use)', async () => {
      const issued = await issueOAuthInstallState(ADMIN_ID, 'slack');
      const first = await verifyOAuthInstallState(issued.state);
      expect(first.ok).toBe(true);

      const second = await verifyOAuthInstallState(issued.state);

      expect(second).toEqual({ ok: false, reason: 'already-consumed' });
    });

    it('never lets two concurrent verifications of the same state both succeed', async () => {
      const issued = await issueOAuthInstallState(ADMIN_ID, 'slack');

      const [first, second] = await Promise.all([
        verifyOAuthInstallState(issued.state),
        verifyOAuthInstallState(issued.state),
      ]);

      const successes = [first, second].filter((r) => r.ok);
      expect(successes).toHaveLength(1);
    });
  });
});
