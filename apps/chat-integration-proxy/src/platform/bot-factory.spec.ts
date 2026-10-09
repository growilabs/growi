// Task 3.1: 「4 サービスそれぞれで bot が組み立てられ、ロックが取れる」 and
// 「**分散ロックを外へ出す**（Chat SDK の state が持つものを、SDK の型を
// 含まない形で渡す）」.
//
// The distributed lock is the substance of this file. The Chat SDK's state
// hands out a *token-bearing* `Lock` object and wants that same object back to
// extend or release it; `DistributedLock` (types/distributed-lock.ts) is
// key-based and carries no SDK type at all, because `runtime/sweeper.ts` and
// `ConnectionManager` both use it from outside this layer. Keeping the tokens
// on this side of that boundary is what the tests below pin down.
import type { Lock, StateAdapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';
import {
  createAppBot,
  createDistributedLock,
  createInstallationBot,
  LOCK_KEY_NAMESPACE,
} from './bot-factory.js';

const APP_CONFIG: PlatformAppConfig = {
  slack: {
    signingSecret: 'signing-secret',
    clientId: 'slack-client-id',
    clientSecret: 'slack-client-secret',
    appToken: 'xapp-1-test',
  },
  discord: {
    applicationId: 'discord-app-id',
    publicKey: '0'.repeat(64),
    clientSecret: 'discord-client-secret',
    botToken: 'discord-bot-token',
  },
  teams: { clientId: 'teams-client-id', clientSecret: 'teams-client-secret' },
  stateConnectionString: 'postgres://user:pw@postgres:5432/chat_sdk',
};

const lockFor = (key: string, token: string): Lock => ({
  threadId: `${LOCK_KEY_NAMESPACE}${key}`,
  token,
  expiresAt: Date.now() + 60_000,
});

describe('createDistributedLock', () => {
  it('reports the lock as taken when the state grants it', async () => {
    const state = mock<StateAdapter>();
    state.acquireLock.mockResolvedValue(lockFor('app:slack', 'token-1'));

    const locks = createDistributedLock(state);

    await expect(locks.acquire('app:slack', 30_000)).resolves.toBe(true);
  });

  it('reports the lock as not taken when another proxy already holds it', async () => {
    const state = mock<StateAdapter>();
    state.acquireLock.mockResolvedValue(null);

    const locks = createDistributedLock(state);

    await expect(locks.acquire('app:slack', 30_000)).resolves.toBe(false);
  });

  it('keeps this app lock keys out of the key space the Chat SDK uses for per-thread concurrency', async () => {
    // The SDK's own thread locks and these connection locks share one
    // `chat_state_locks` table, keyed by `(key_prefix, thread_id)`. Prefixing
    // makes a collision with an adapter-encoded thread id structurally
    // impossible instead of merely unlikely.
    const state = mock<StateAdapter>();
    state.acquireLock.mockResolvedValue(lockFor('app:slack', 'token-1'));

    await createDistributedLock(state).acquire('app:slack', 30_000);

    expect(state.acquireLock).toHaveBeenCalledWith(
      `${LOCK_KEY_NAMESPACE}app:slack`,
      30_000,
    );
  });

  it('renews a lock it holds by handing back the token the state issued', async () => {
    const state = mock<StateAdapter>();
    const granted = lockFor('app:discord', 'token-1');
    state.acquireLock.mockResolvedValue(granted);
    state.extendLock.mockResolvedValue(true);

    const locks = createDistributedLock(state);
    await locks.acquire('app:discord', 30_000);

    await expect(locks.renew('app:discord', 30_000)).resolves.toBe(true);
    expect(state.extendLock).toHaveBeenCalledWith(granted, 30_000);
  });

  it('renews with the newest token after the lock was re-acquired', async () => {
    // A lapsed TTL lets the state grant the same key again under a NEW token.
    // Holding on to the stale one would make every later renew/release address
    // a lock this app no longer owns.
    const state = mock<StateAdapter>();
    const first = lockFor('app:slack', 'token-1');
    const second = lockFor('app:slack', 'token-2');
    state.acquireLock
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    state.extendLock.mockResolvedValue(true);

    const locks = createDistributedLock(state);
    await locks.acquire('app:slack', 30_000);
    await locks.acquire('app:slack', 30_000);
    await locks.renew('app:slack', 30_000);

    expect(state.extendLock).toHaveBeenCalledWith(second, 30_000);
  });

  it('leaves the held token alone when a re-acquire is refused', async () => {
    const state = mock<StateAdapter>();
    const granted = lockFor('app:slack', 'token-1');
    state.acquireLock
      .mockResolvedValueOnce(granted)
      .mockResolvedValueOnce(null);
    state.extendLock.mockResolvedValue(true);

    const locks = createDistributedLock(state);
    await locks.acquire('app:slack', 30_000);
    await locks.acquire('app:slack', 30_000);

    await expect(locks.renew('app:slack', 30_000)).resolves.toBe(true);
    expect(state.extendLock).toHaveBeenCalledWith(granted, 30_000);
  });

  it('refuses to renew a key it never took, without asking the state', async () => {
    const state = mock<StateAdapter>();

    const locks = createDistributedLock(state);

    await expect(locks.renew('app:slack', 30_000)).resolves.toBe(false);
    expect(state.extendLock).not.toHaveBeenCalled();
  });

  it('gives up the lock for good once the state refuses to extend it', async () => {
    // ConnectionManager (task 3.8) closes its connection when a renew fails.
    // If this side kept the entry, the next renew would report success again
    // against a lock another proxy may already have taken over.
    const state = mock<StateAdapter>();
    state.acquireLock.mockResolvedValue(lockFor('app:slack', 'token-1'));
    state.extendLock.mockResolvedValue(false);

    const locks = createDistributedLock(state);
    await locks.acquire('app:slack', 30_000);

    await expect(locks.renew('app:slack', 30_000)).resolves.toBe(false);
    state.extendLock.mockClear();
    await expect(locks.renew('app:slack', 30_000)).resolves.toBe(false);
    expect(state.extendLock).not.toHaveBeenCalled();
  });

  it('releases the lock it holds and then holds it no longer', async () => {
    const state = mock<StateAdapter>();
    const granted = lockFor('installation:inst-1', 'token-1');
    state.acquireLock.mockResolvedValue(granted);

    const locks = createDistributedLock(state);
    await locks.acquire('installation:inst-1', 30_000);
    await locks.release('installation:inst-1');

    expect(state.releaseLock).toHaveBeenCalledWith(granted);
    await expect(locks.renew('installation:inst-1', 30_000)).resolves.toBe(
      false,
    );
  });

  it('does nothing when asked to release a key it never took', async () => {
    const state = mock<StateAdapter>();

    await createDistributedLock(state).release('app:slack');

    expect(state.releaseLock).not.toHaveBeenCalled();
  });
});

describe('createAppBot', () => {
  it('assembles one bot holding an adapter for every service the app config configures', async () => {
    const appBot = createAppBot(APP_CONFIG);

    expect([...appBot.platforms].sort()).toEqual(
      ['discord', 'slack', 'teams'].sort(),
    );
    await appBot.state.disconnect();
  });

  it('assembles a bot for a single-service deployment without demanding the other services', async () => {
    const { discord, teams, ...slackOnly } = APP_CONFIG;

    const appBot = createAppBot(slackOnly);

    expect(appBot.platforms).toEqual(['slack']);
    await appBot.state.disconnect();
  });

  it('hands out a distributed lock backed by the same state the bot uses', async () => {
    // One state adapter, therefore one lock namespace: `runtime/sweeper.ts`
    // and `ConnectionManager` must contend with each other and with the other
    // proxies, not with separate private tables.
    const appBot = createAppBot(APP_CONFIG);
    appBot.state.acquireLock = vi.fn().mockResolvedValue(null);

    await expect(appBot.locks.acquire('app:slack', 30_000)).resolves.toBe(
      false,
    );
    expect(appBot.state.acquireLock).toHaveBeenCalledWith(
      `${LOCK_KEY_NAMESPACE}app:slack`,
      30_000,
    );
    await appBot.state.disconnect();
  });
});

describe('createInstallationBot', () => {
  // Mattermost is the one service whose connection target lives on the
  // installation rather than on the app config, so its bot is assembled per
  // installation -- but it shares the app's state adapter, so its connection
  // lock contends in the same key space as everyone else's.
  const credentials: InstallationCredentials = {
    mattermost: {
      baseUrl: 'https://mattermost.example.com',
      botToken: 'mattermost-bot-token',
    },
  };

  it('assembles a mattermost bot from one installation own connection target', async () => {
    const appBot = createAppBot(APP_CONFIG);

    const bot = createInstallationBot('mattermost', credentials, appBot.state);

    expect(bot).not.toBeNull();
    await appBot.state.disconnect();
  });

  it('assembles nothing when that installation carries no credentials for the service', async () => {
    const appBot = createAppBot(APP_CONFIG);

    expect(createInstallationBot('mattermost', {}, appBot.state)).toBeNull();
    await appBot.state.disconnect();
  });
});
