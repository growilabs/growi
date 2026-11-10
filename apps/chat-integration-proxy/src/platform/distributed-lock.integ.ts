// Task 3.1's acceptance criterion 「ロックが取れる」, against a real PostgreSQL.
//
// `bot-factory.spec.ts` pins the *wrapping* logic (which token is handed back,
// when the held entry is dropped) with a mocked `StateAdapter`. What it cannot
// answer is whether the Chat SDK's PostgreSQL state actually behaves the way
// that wrapper assumes -- that a second process is refused the same key while
// the first still holds it, and that releasing it hands it over. Those are
// claims about rows in `chat_state_locks`, so they are asserted here through
// two independent state adapters over one database, standing in for two proxy
// processes.
//
// The connection string is read from the environment the same way (and for the
// same reason) `src/postgres-connectivity.integ.ts` reads it: `runtime/config.ts`
// is the only file in the *application* allowed to read env vars, and this is a
// test. The default mirrors `.env.development`.
import { randomUUID } from 'node:crypto';
import { createPostgresState } from '@chat-adapter/state-pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createDistributedLock } from './bot-factory.js';

const CHAT_SDK_DATABASE_URL =
  process.env.CHAT_SDK_DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy?options=-c%20search_path%3Dchat_sdk';

const TTL_MS = 30_000;

// One state adapter per "process": the held-token map lives inside
// `createDistributedLock`, so two locks over ONE state adapter would only ever
// exercise this process's own bookkeeping, never the database's arbitration.
const states = [
  createPostgresState({ url: CHAT_SDK_DATABASE_URL }),
  createPostgresState({ url: CHAT_SDK_DATABASE_URL }),
];
const [firstProxy, secondProxy] = states.map(createDistributedLock);

/**
 * `PostgresStateAdapter` does not connect on first use -- it throws until
 * `connect()` has resolved. `createAppBot` deliberately leaves this to the
 * caller (see `AppBot.state`), so the test does it too.
 *
 * Called from inside each test rather than from `beforeAll`: a throwing
 * `beforeAll` marks the file's tests *skipped*, and a lock that is genuinely
 * broken would then read as "skipped" in the summary instead of failing. The
 * two integ files that predate this one connect inside their test bodies for
 * the same reason.
 */
const connectAll = async (): Promise<void> => {
  await Promise.all(states.map((state) => state.connect()));
};

afterAll(async () => {
  await Promise.all(states.map((state) => state.disconnect()));
});

describe('distributed lock over the Chat SDK PostgreSQL state (task 3.1)', () => {
  it('lets exactly one proxy hold a connection key, and hands it over once released', async () => {
    // A fresh key per run: the row outlives the test, and a hard-coded key
    // would make a re-run depend on the previous run's cleanup.
    const key = `app:slack:${randomUUID()}`;
    await connectAll();

    await expect(firstProxy.acquire(key, TTL_MS)).resolves.toBe(true);
    await expect(secondProxy.acquire(key, TTL_MS)).resolves.toBe(false);

    await expect(firstProxy.renew(key, TTL_MS)).resolves.toBe(true);
    // The proxy that never took it cannot extend it either.
    await expect(secondProxy.renew(key, TTL_MS)).resolves.toBe(false);

    await firstProxy.release(key);

    await expect(secondProxy.acquire(key, TTL_MS)).resolves.toBe(true);
    await secondProxy.release(key);
  });

  it('keeps two different connection keys apart', async () => {
    // design.md's 接続の単位 table gives Mattermost one key per installation:
    // holding one must not block another.
    await connectAll();
    const first = `installation:${randomUUID()}`;
    const second = `installation:${randomUUID()}`;

    await expect(firstProxy.acquire(first, TTL_MS)).resolves.toBe(true);
    await expect(secondProxy.acquire(second, TTL_MS)).resolves.toBe(true);

    await firstProxy.release(first);
    await secondProxy.release(second);
  });
});
