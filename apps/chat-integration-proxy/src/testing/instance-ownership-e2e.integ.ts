// Task 11.4 -- who owns what when more than one proxy instance is running,
// driven against a real PostgreSQL.
//
// **This file is EXPECTED to be red in this devcontainer**, for the same
// reason `harness-round-trip.integ.ts`, `command-flow-e2e.integ.ts` and
// `notification-linking-e2e.integ.ts` are: the `postgres` hostname does not
// resolve here (Implementation Note 1.2). There is deliberately no
// `beforeAll` -- a failing `beforeAll` SKIPS the bodies, so not one assertion
// below would ever be parsed while storage is unreachable.
//
// **What this file traces to.** tasks.md lists 「_Requirements: 1.1, 1.4,
// 8.1_」 for this task, and two of those three do not say what the task's
// bullets say. Requirement 1.4 is about carrying on with the OTHER chat
// services when one service's processing fails unexpectedly -- failure
// isolation across services, which `connection-manager.ts` gets right by
// reconciling each unit inside its own `try`, and which is task 3.8's to
// prove, not this one's. Requirement 8.1 is about binding several GROWIs to
// one chat workspace and has nothing to do with how many proxy instances run.
// Of the three only Requirement 1.1 applies, and only through its 「その
// サービスに対して機能を提供する」: a service is served exactly when its
// connection is open, and this file's subject is that it is open ONCE.
// 「持ち分」 itself is a design.md constraint --「**水平に増やせる状態を保
// つ。** … Chat SDK が要求する分散ロックと重複排除は `state-pg` が担う」--
// with no acceptance criterion of its own in requirements.md. See this task's
// Implementation Note.
//
// **Everything under test here is decided in PostgreSQL, not in this
// process.** `@chat-adapter/state-pg` grants a lock by inserting a row and
// refusing the insert while an unexpired one exists; it extends a grant only
// for the token that holds it; it deletes a grant only by that same token. So
// two instances started in one process contend for exactly the grant a real
// pair of processes would (Implementation Note 11.1) -- which is why the
// instances below are started with the REAL `createPlatformFacade` and NOT
// with `fake-chat-service.ts`, whose `locks()` never contends
// (Implementation Note 11.1 (b)).
//
// **Which service each of task 11.4's bullets is actually about.**
// `CONNECTION_UNIT_TABLE` (`capabilities/`) is the only place that decides
// this, and it reads: Slack and Discord `per-app`, Mattermost
// `per-installation`, **Teams `none`**. So the 「installation ごとのサービス」
// bullet is about MATTERMOST, not about Teams -- Teams dials in over a
// webhook and never becomes a connection unit at all, so there is no
// per-installation ownership of it to check. Nor is the sweeper an
// alternative reading of that bullet: its lock is one global `proxy:sweep`
// key, not one key per installation.
//
// **Why Discord can be driven through the completely real facade.** Its
// adapter's `initialize()` only resolves an application id, and a literal
// `applicationId` is already resolved, so opening the `app:discord` unit
// touches no network and exposes no `disconnect()` to fail on either. That is
// the same fact Implementation Note 3.8 (d) records as a Revalidation Trigger
// candidate -- **if Discord ever gains a real Gateway connection, the cases
// below that use the real facade have to move to the injected-dial mechanism
// the Mattermost cases already use.**
//
// **Why the Mattermost cases inject `open`/`close`.** Its adapter's
// `initialize()` fetches `/api/v4/users/me` and then opens a WebSocket, and
// this app has no WebSocket server library to answer that with. So those
// cases keep the real Postgres-backed lock, the real `ConnectionManager` and
// the real `CONNECTION_UNIT_TABLE`, and substitute ONLY the socket dial --
// which is the seam `connection-manager.ts` was given `open`/`close` for in
// the first place. What they prove is the part a live Mattermost would not
// add to: that the per-installation key is owned by exactly one instance.

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { CONNECTION_UNIT_TABLE } from '../capabilities/index.js';
import {
  createPrismaClient,
  createRelationRepository,
  createRequestNonceRepository,
  type PrismaClient,
} from '../db/index.js';
import {
  type ConnectionUnitRef,
  createConnectionManager,
} from '../platform/connection-manager.js';
import type {
  ConnectionStatusRow,
  InstallationProvider,
  PlatformFacade,
} from '../platform/index.js';
import { createPlatformFacade } from '../platform/index.js';
import type { ProxyConfig, StartProxyOverrides } from '../runtime/index.js';
import { SWEEP_LOCK_KEY } from '../runtime/sweeper.js';
import { LOOPBACK, listenOnFreePort } from './free-port.js';
import { openWorkspace, passthroughCipher } from './paired-workspace.js';
import {
  type ProxyCluster,
  type ProxyInstance,
  startProxyCluster,
} from './proxy-cluster.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const CHAT_SDK_DATABASE_URL =
  process.env.CHAT_SDK_DATABASE_URL ??
  `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`;

/**
 * The lock keys, read from the table that declares them rather than spelled
 * out here. Both throw at module load if the table ever changes shape, so
 * that a service reclassified out of `per-app` (or out of
 * `per-installation`) fails loudly instead of leaving these cases silently
 * asserting about a key nothing uses.
 */
const discordLockKey = (): string => {
  const unit = CONNECTION_UNIT_TABLE.discord;
  if (unit.kind !== 'per-app') {
    throw new Error(`discord is no longer a per-app connection: ${unit.kind}`);
  }
  return unit.lockKey;
};

const mattermostLockKey = (installationId: string): string => {
  const unit = CONNECTION_UNIT_TABLE.mattermost;
  if (unit.kind !== 'per-installation') {
    throw new Error(
      `mattermost is no longer a per-installation connection: ${unit.kind}`,
    );
  }
  return `${unit.lockKeyPrefix}${installationId}`;
};

const DISCORD_LOCK_KEY = discordLockKey();

/**
 * Configures Discord and nothing else. The values are literals on purpose:
 * a literal `applicationId` is what keeps `initialize()` from calling out,
 * and passing every field the adapter looks for is what keeps it from falling
 * back to `process.env` (Implementation Note 3.1).
 */
const proxyConfig = (): ProxyConfig => ({
  platformApp: {
    discord: {
      applicationId: '000000000000000001',
      publicKey: '0'.repeat(64),
      clientSecret: 'discord-client-secret',
      botToken: 'discord-bot-token',
    },
    stateConnectionString: CHAT_SDK_DATABASE_URL,
  },
  closedNetwork: { allowList: [LOOPBACK], trustedCaCertsFor: () => [] },
  cipher: passthroughCipher,
  databaseUrl: DATABASE_URL,
  http: { port: 0, bodyLimitBytes: 1024 * 1024 },
  mattermostInstallations: [],
});

let cluster: ProxyCluster | null = null;
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await cluster?.stopAll();
  cluster = null;
  await Promise.all(closers.splice(0).map((close) => close()));
});

const openDb = (): PrismaClient => {
  const db = createPrismaClient(DATABASE_URL);
  closers.push(() => db.$disconnect());
  return db;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------------------------------------------------------------------------
// Scoping an instance to the installations the case created
// ---------------------------------------------------------------------------

/**
 * The same installations, minus every row this case did not create.
 *
 * The database outlives a test run, so `list()` would otherwise hand
 * `ConnectionManager` every Mattermost server any earlier case ever declared
 * and it would dial each of them. Filtering here rather than deleting rows
 * keeps cases independent of one another's leftovers without any case owning
 * the right to remove another's data.
 */
const onlyInstallations = (
  provider: InstallationProvider,
  installationIds: ReadonlyArray<string>,
): InstallationProvider => ({
  resolve: (platform, workspaceId) => provider.resolve(platform, workspaceId),
  list: async (platform) =>
    (await provider.list(platform)).filter((row) =>
      installationIds.includes(row.installationId),
    ),
});

/** Everything an instance reported outward, instead of onto stderr. */
type FailureLog = string[];

const reportersInto = (failures: FailureLog) => ({
  reportOperationalFailure: (message: string) => {
    failures.push(message);
  },
});

/** The real facade, serving only the installations this case declared. */
const realFacadeServing =
  (
    installationIds: ReadonlyArray<string>,
  ): NonNullable<StartProxyOverrides['createFacade']> =>
  (appConfig, installations, sink) =>
    createPlatformFacade(
      appConfig,
      onlyInstallations(installations, installationIds),
      sink,
    );

interface ConnectionLog {
  readonly opened: string[];
  readonly closed: string[];
}

/** One `ConnectionLog` per instance name, made on first use. */
const connectionLogs = (): ((name: string) => ConnectionLog) => {
  const logs = new Map<string, ConnectionLog>();
  return (name) => {
    const existing = logs.get(name);
    if (existing != null) return existing;
    const created: ConnectionLog = { opened: [], closed: [] };
    logs.set(name, created);
    return created;
  };
};

interface DialTimings {
  readonly intervalMs: number;
  readonly lockTtlMs: number;
}

/**
 * The real facade with the socket dial replaced by a recorder, for the
 * per-installation service.
 *
 * Only `open` / `close` are substituted: the lock is the facade's own
 * Postgres-backed one, the loop is the production `ConnectionManager`, and
 * the lock keys come from the production `CONNECTION_UNIT_TABLE`. `shutdown`
 * is wrapped as well, because the facade's own `shutdown` gives back the
 * connections IT built, and these are not those.
 */
const recordingFacadeServing =
  (
    installationIds: ReadonlyArray<string>,
    log: ConnectionLog,
    timings: DialTimings,
  ): NonNullable<StartProxyOverrides['createFacade']> =>
  async (appConfig, installations, sink): Promise<PlatformFacade> => {
    const scoped = onlyInstallations(installations, installationIds);
    const facade = await createPlatformFacade(appConfig, scoped, sink);
    const connections = createConnectionManager({
      platforms: ['mattermost'],
      units: CONNECTION_UNIT_TABLE,
      installations: scoped,
      locks: facade.locks(),
      open: (unit: ConnectionUnitRef) => {
        log.opened.push(unit.lockKey);
        return Promise.resolve();
      },
      close: (unit: ConnectionUnitRef) => {
        log.closed.push(unit.lockKey);
        return Promise.resolve();
      },
      intervalMs: timings.intervalMs,
      lockTtlMs: timings.lockTtlMs,
    });
    return {
      ...facade,
      connections: () => connections,
      shutdown: async () => {
        await connections.stopAll();
        await facade.shutdown();
      },
    };
  };

const NAMES = ['first', 'second'] as const;

const startInstances = async (
  createFacadeFor: (
    name: string,
  ) => NonNullable<StartProxyOverrides['createFacade']>,
  failures: FailureLog,
): Promise<ProxyCluster> => {
  const started = await startProxyCluster(
    NAMES.map((name) => ({
      name,
      config: proxyConfig(),
      overrides: {
        listen: listenOnFreePort().listen,
        createFacade: createFacadeFor(name),
        reporters: reportersInto(failures),
      },
    })),
  );
  cluster = started;
  return started;
};

// ---------------------------------------------------------------------------
// Reading who owns what
// ---------------------------------------------------------------------------

const connectionsOf = (instance: ProxyInstance) =>
  instance.proxy.dependencies.facade.connections();

const rowFor = async (
  instance: ProxyInstance,
  lockKey: string,
): Promise<ConnectionStatusRow | undefined> =>
  (await connectionsOf(instance).status()).find(
    (row) => row.lockKey === lockKey,
  );

interface Ownership {
  /** Instance names reporting they serve the unit themselves. */
  readonly connected: ReadonlyArray<string>;
  /** Instance names reporting another instance serves it. */
  readonly heldByOther: ReadonlyArray<string>;
}

const ownershipOf = async (
  running: ProxyCluster,
  lockKey: string,
): Promise<Ownership> => {
  const rows = await Promise.all(
    NAMES.map(async (name) => ({
      name,
      row: await rowFor(running.get(name), lockKey),
    })),
  );
  return {
    connected: rows
      .filter((entry) => entry.row?.state === 'connected')
      .map((entry) => entry.name),
    heldByOther: rows
      .filter((entry) => entry.row?.state === 'held-by-other')
      .map((entry) => entry.name),
  };
};

const soleOwnerOf = async (
  running: ProxyCluster,
  lockKey: string,
): Promise<string> => {
  const { connected } = await ownershipOf(running, lockKey);
  const [owner, ...rest] = connected;
  if (owner == null || rest.length > 0) {
    throw new Error(
      `expected exactly one instance to serve ${lockKey}, got ${connected.length}`,
    );
  }
  return owner;
};

const theOtherName = (owner: string): string => {
  const other = NAMES.find((name) => name !== owner);
  if (other == null) throw new Error('the cluster has only one instance');
  return other;
};

// ---------------------------------------------------------------------------

describe('what two running proxy instances each own (task 11.4)', () => {
  it('opens one connection for an app-wide service however many instances run', async () => {
    const failures: FailureLog = [];
    const running = await startInstances(() => realFacadeServing([]), failures);

    const ownership = await ownershipOf(running, DISCORD_LOCK_KEY);

    // One connection per app, not one per instance -- what Requirement 1.1's
    // 「そのサービスに対して機能を提供する」 amounts to once a service is
    // served over a single always-on connection.
    expect(ownership.connected).toHaveLength(1);
    // The other instance is not idle by accident -- `held-by-other` is only
    // reachable by asking PostgreSQL for the grant and being refused.
    expect(ownership.heldByOther).toHaveLength(1);

    // Nothing else was opened: with no installations, an app-wide service is
    // still wanted, and a per-installation one is not.
    for (const name of NAMES) {
      // biome-ignore lint/performance/noAwaitInLoops: one instance is read at a time, so a failure names which one
      const rows = await connectionsOf(running.get(name))
        .status()
        .then((all) => all.map((row) => row.lockKey));
      expect(rows).toEqual([DISCORD_LOCK_KEY]);
    }
  });

  it('gives an app-wide connection to the other instance once its owner stops', async () => {
    const failures: FailureLog = [];
    const running = await startInstances(() => realFacadeServing([]), failures);

    const owner = await soleOwnerOf(running, DISCORD_LOCK_KEY);
    const successor = theOtherName(owner);

    // While the owner is up and its grant is current, the other one asks and
    // is refused.
    await connectionsOf(running.get(successor)).reconcile();
    expect((await ownershipOf(running, DISCORD_LOCK_KEY)).connected).toEqual([
      owner,
    ]);

    await running.stop(owner);

    await connectionsOf(running.get(successor)).reconcile();
    expect(
      (await rowFor(running.get(successor), DISCORD_LOCK_KEY))?.state,
    ).toBe('connected');
  });

  it('gives each installation of a per-installation service to exactly one instance', async () => {
    const db = openDb();
    const workspaces = await Promise.all([
      openWorkspace(db, 'mattermost'),
      openWorkspace(db, 'mattermost'),
    ]);
    const installationIds = workspaces.map(
      (workspace) => workspace.installationId,
    );
    const logOf = connectionLogs();
    const failures: FailureLog = [];

    // Production requires the grant to outlive the reconcile interval by 3x
    // (`connection-manager.ts`'s `LOCK_TTL_MS`/`RECONCILE_INTERVAL_MS`); this
    // inverts that on purpose. Nothing here renews or reconciles on a timer --
    // ownership is read once per installation right after startup -- so
    // there is no periodic renewal for a short grant to lapse under, and the
    // long interval only keeps an automatic tick from firing during the read.
    const running = await startInstances(
      (name) =>
        recordingFacadeServing(installationIds, logOf(name), {
          intervalMs: 600_000,
          lockTtlMs: 60_000,
        }),
      failures,
    );

    for (const installationId of installationIds) {
      const lockKey = mattermostLockKey(installationId);
      // biome-ignore lint/performance/noAwaitInLoops: one installation is read at a time, so a failure names which one
      const ownership = await ownershipOf(running, lockKey);

      expect(ownership.connected).toHaveLength(1);
      expect(ownership.heldByOther).toHaveLength(1);

      // And the ownership is not merely reported: the dial happened once
      // across both instances, on the instance that reports it.
      const dialled = NAMES.filter((name) =>
        logOf(name).opened.includes(lockKey),
      );
      expect(dialled).toEqual(ownership.connected);
    }

    // The two installations are separate units, not one shared connection.
    expect(NAMES.flatMap((name) => logOf(name).opened).sort()).toEqual(
      installationIds.map(mattermostLockKey).sort(),
    );
  });

  // This case deliberately sleeps in real time (6 rounds of lockTtlMs/4, then
  // lockTtlMs*1.5) to make renewal-across-expiry observable -- with lockTtlMs
  // = 2_000 that is ~6s of real waiting, past Vitest's 5s default per-test
  // timeout, hence the explicit 15_000 below.
  it('keeps an installation while its owner renews, and only lets go once it stops renewing', async () => {
    const db = openDb();
    const workspace = await openWorkspace(db, 'mattermost');
    const lockKey = mattermostLockKey(workspace.installationId);
    const logOf = connectionLogs();
    const failures: FailureLog = [];

    // A grant far shorter than production's, so that "renewed across the
    // point it would otherwise have lapsed" is observable inside a test
    // rather than a minute later. Renewed every quarter of it rather than
    // every half, so that one slow round -- a pause, a slow round-trip --
    // cannot let the grant lapse and report a theft the product did not
    // commit. The interval is set long instead so that no tick fires on its
    // own: every reconciliation below is one this test asked for, which is
    // what makes "the owner stopped renewing" something the test can arrange.
    const lockTtlMs = 2_000;
    const running = await startInstances(
      (name) =>
        recordingFacadeServing([workspace.installationId], logOf(name), {
          intervalMs: 600_000,
          lockTtlMs,
        }),
      failures,
    );

    const owner = await soleOwnerOf(running, lockKey);
    const challenger = theOtherName(owner);

    // Renewed across more than the whole grant, with the other instance
    // asking throughout: 「ロックが延長され続ける限り奪われない」.
    for (let round = 0; round < 6; round += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the rounds ARE the passage of time this case arranges; run at once they would arrange nothing
      await sleep(lockTtlMs / 4);
      await connectionsOf(running.get(owner)).reconcile();
      await connectionsOf(running.get(challenger)).reconcile();
    }

    expect((await rowFor(running.get(owner), lockKey))?.state).toBe(
      'connected',
    );
    expect((await rowFor(running.get(challenger), lockKey))?.state).toBe(
      'held-by-other',
    );
    expect(logOf(challenger).opened).toEqual([]);

    // The owner stops renewing -- nothing else changes -- and only then is
    // the grant available to anyone else.
    await sleep(lockTtlMs * 1.5);
    await connectionsOf(running.get(challenger)).reconcile();

    expect((await rowFor(running.get(challenger), lockKey))?.state).toBe(
      'connected',
    );
    expect(logOf(challenger).opened).toEqual([lockKey]);
  }, 15_000);

  it('runs the periodic sweep on one instance at a time', async () => {
    const db = openDb();
    const workspace = await openWorkspace(db, 'discord');
    const relation = await createRelationRepository(db).create({
      installationId: workspace.installationId,
      growiUri: `http://${LOOPBACK}:1/`,
      growiLabel: 'sweep fixture',
      searchWeight: 1,
      settingsVersion: 1,
    });
    // A row that is already past its expiry, so "the sweep ran" and "the
    // sweep did not run" are distinguishable by looking at storage rather
    // than by trusting the answer `sweepOnce` gives.
    const nonce = `nonce-${randomUUID()}`;
    await createRequestNonceRepository(db).consumeNonce(
      { relationId: relation.relationId, keyId: `key-${randomUUID()}` },
      nonce,
      new Date(Date.now() - 60_000),
    );
    const noncesLeft = (): Promise<number> =>
      db.requestNonce.count({ where: { relationId: relation.relationId } });

    const failures: FailureLog = [];
    const running = await startInstances(() => realFacadeServing([]), failures);

    const [firstName, secondName] = NAMES;
    const holder = running.get(firstName);
    const other = running.get(secondName);

    // The first instance is mid-sweep, expressed the way a sweep expresses it
    // -- it holds `proxy:sweep` through its own facade's lock.
    expect(
      await holder.proxy.dependencies.facade
        .locks()
        .acquire(SWEEP_LOCK_KEY, 60_000),
    ).toBe(true);

    expect(await other.proxy.dependencies.sweeper.sweepOnce()).toBe(false);
    // Not a partial second sweep -- no second sweep at all. Both halves of
    // one cycle are checked: the reaping did not happen (the expired row is
    // still there), and the channel re-take did not happen either. The
    // re-take is visible through the reported failures: this instance serves
    // no installation (`realFacadeServing([])`), so every re-take it attempts
    // fails at once and says so. Silence therefore means it never got as far
    // as attempting one.
    expect(await noncesLeft()).toBe(1);
    expect(failures).toEqual([]);

    await holder.proxy.dependencies.facade.locks().release(SWEEP_LOCK_KEY);

    expect(await other.proxy.dependencies.sweeper.sweepOnce()).toBe(true);
    expect(await noncesLeft()).toBe(0);
    expect(failures.length).toBeGreaterThan(0);
  });
});
