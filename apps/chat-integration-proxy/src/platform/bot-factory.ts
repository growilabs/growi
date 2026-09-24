// Assembles what `adapter-set.ts` builds into a running Chat SDK instance, and
// re-exposes the SDK state's distributed lock in this app's own vocabulary.
//
// Task 3.1 stops here on purpose. `platform/index.ts` -- the layer's public
// entry point, i.e. `createPlatformFacade` -- is task 3.8's deliverable
// (tasks.md 3.8: 「**この層の入口もここでまとめる**」), and it cannot exist
// earlier: `PlatformFacade.connections()` returns the `ConnectionManager` that
// 3.8 itself introduces. Until then nothing outside `platform/` imports this
// file, so there is nothing to publish through a barrel yet.
import type { PostgresStateAdapter } from '@chat-adapter/state-pg';
import type { PlatformName } from '@growi/chat';
import { Chat, type ChatInstance, type Lock, type StateAdapter } from 'chat';

import type {
  DistributedLock,
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';
import {
  ADAPTER_FACTORIES,
  createAppAdapters,
  createChatState,
  createInstallationAdapter,
} from './adapter-set.js';

/**
 * The name the bot answers to. Design.md settles every follow-up interaction
 * on an addressed reply (「`@growi 1`」) rather than on a bare reply, because
 * `plainReply` is unverified on all four services -- so this name is part of
 * the user-facing contract, not a cosmetic default.
 */
export const BOT_USER_NAME = 'growi';

/**
 * Prefix applied to every key handed to `DistributedLock` below.
 *
 * The Chat SDK stores its own per-thread concurrency locks in the same
 * `chat_state_locks` table, keyed by `(key_prefix, thread_id)`. This proxy's
 * connection and sweeper locks (`app:slack`, `installation:{id}` -- design.md's
 * 接続の単位 table) go through `acquireLock()` too, so they land among those
 * rows. Prefixing them makes a collision with an adapter-encoded thread id
 * structurally impossible rather than merely unlikely, which is worth more
 * than the readability of the raw key in the table.
 */
export const LOCK_KEY_NAMESPACE = 'growi-proxy:';

/**
 * Turns the Chat SDK state's token-bearing lock API into the key-based
 * `DistributedLock` the rest of this app sees (design.md: 「Chat SDK の state
 * が持つ分散ロックを、proxy 自身の型で外へ出す」).
 *
 * The SDK hands out a `Lock` carrying the token that proves ownership, and
 * wants that same object back to extend or release it. `ConnectionManager`
 * (task 3.8) and `runtime/sweeper.ts` (task 9.2) both live outside this layer
 * and may not see that type, so the tokens are held here, keyed by the caller's
 * own key.
 *
 * One instance per state adapter: the held-lock map is what makes `renew` and
 * `release` addressable by key, so two instances over the same state would each
 * know only half of what this process holds.
 */
export const createDistributedLock = (state: StateAdapter): DistributedLock => {
  const held = new Map<string, Lock>();

  return {
    async acquire(key, ttlMs) {
      const lock = await state.acquireLock(
        `${LOCK_KEY_NAMESPACE}${key}`,
        ttlMs,
      );
      if (lock == null) return false;
      // Overwrite rather than keep: once a TTL has lapsed the state grants the
      // same key again under a NEW token, and renewing or releasing with the
      // stale one would address a lock this process no longer owns.
      held.set(key, lock);
      return true;
    },

    async renew(key, ttlMs) {
      const lock = held.get(key);
      if (lock == null) return false;
      const extended = await state.extendLock(lock, ttlMs);
      // A refused extension means the lock is gone -- someone else may already
      // hold it. Dropping it here is what lets `ConnectionManager` treat a
      // failed renew as final instead of seeing the next renew succeed again.
      if (!extended) held.delete(key);
      return extended;
    },

    async release(key) {
      const lock = held.get(key);
      if (lock == null) return;
      // Forgotten first: this process is giving the lock up either way, and a
      // failing release must not leave behind an entry that later renews.
      held.delete(key);
      await state.releaseLock(lock);
    },
  };
};

/** One Chat SDK instance plus the state and locks it was assembled over. */
export interface AppBot {
  readonly bot: ChatInstance;
  /**
   * **`connect()` this before using `locks` or the bot.**
   * `PostgresStateAdapter` does not connect on first use -- every one of its
   * methods throws "PostgresStateAdapter is not connected. Call connect()
   * first." until `connect()` has resolved. `createPlatformFacade` (task 3.8)
   * is asynchronous for exactly this reason; it is the caller that owns
   * process startup and shutdown, so it is also the one that can call
   * `disconnect()` at the end.
   */
  readonly state: PostgresStateAdapter;
  readonly locks: DistributedLock;
  /** The services this deployment configured, in registry order. */
  readonly platforms: ReadonlyArray<PlatformName>;
}

/**
 * Assembles the app-wide bot: the SDK state, one adapter per configured
 * app-credentialed service, and the distributed lock over that same state.
 *
 * Sharing one state adapter is deliberate -- `ConnectionManager` and the
 * sweeper must contend with each other and with the other proxy processes in
 * one key space, which a second state adapter would silently split.
 *
 * Assembly only -- nothing here opens a socket or a database connection, which
 * is what keeps it unit-testable. Connecting is the caller's step; see the
 * warning on `AppBot.state`.
 *
 * **No production code calls this today.** `AppBot.bot` is typed
 * `ChatInstance`, which carries no way to register handlers, serve webhooks,
 * or reach the adapter behind one connection unit, so a caller that needs any
 * of those cannot use what this returns -- `platform/index.ts` builds instead
 * from `adapter-set.ts` plus one `Chat` per adapter. Whether this should
 * return `Chat` and expose its adapters, or be removed, is an open decision
 * for whoever next changes this file.
 */
export const createAppBot = (appConfig: PlatformAppConfig): AppBot => {
  const state = createChatState(appConfig);
  const adapters = createAppAdapters(appConfig, ADAPTER_FACTORIES);

  return {
    bot: new Chat({ adapters, state, userName: BOT_USER_NAME }),
    state,
    locks: createDistributedLock(state),
    // `Object.keys` always widens to `string[]`; `adapters`' own key type is
    // already `PlatformName`, so this narrows back rather than claiming
    // anything the builder did not guarantee.
    platforms: Object.keys(adapters) as ReadonlyArray<PlatformName>,
  };
};

/**
 * Assembles the bot for one installation of an installation-credentialed
 * service (Mattermost). Returns `null` when that installation carries no
 * credentials for the service, or when the service is app-credentialed and so
 * has no per-installation connection to open.
 *
 * `state` is passed in rather than created here so that every bot in the
 * process -- app-wide and per-installation alike -- shares one lock key space.
 *
 * **No production code calls this today**, for the same reason as
 * `createAppBot`: a `ChatInstance` cannot register handlers, serve webhooks or
 * expose its adapter, so `platform/index.ts` composes per-installation
 * connections directly from `adapter-set.ts`. Changing the return type or
 * removing this is an open decision for whoever next changes this file.
 */
export const createInstallationBot = (
  platform: PlatformName,
  credentials: InstallationCredentials,
  state: StateAdapter,
): ChatInstance | null => {
  const adapter = createInstallationAdapter(
    platform,
    credentials,
    ADAPTER_FACTORIES,
  );
  if (adapter == null) return null;

  return new Chat({
    adapters: { [platform]: adapter },
    state,
    userName: BOT_USER_NAME,
  });
};
