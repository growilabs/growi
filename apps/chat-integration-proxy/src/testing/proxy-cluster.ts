// Several proxy instances brought up and taken down together (tasks.md 11.1's
// 「複数のプロセスを起動して止める仕組み（持ち分の確認に使う）」).
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE -- see `signing-identity.ts`.
//
// **These are instances in one process, not child processes -- a deliberate
// departure from the wording of task 11.1.** Two reasons:
//
//  - The ownership rules task 11.4 checks are decided in PostgreSQL, not in
//    process memory: `@chat-adapter/state-pg` holds the distributed lock, and
//    each instance builds its own state connection through
//    `createPlatformFacade`. Two instances in one process therefore contend
//    for exactly the same grant a real pair of processes would.
//  - A child process cannot be handed the fake GROWI and fake chat service.
//    `startProxy`'s injectable `listen` / `createDb` / `createFacade`
//    (Implementation Note 9.1) only reach an instance started in-process, and
//    without them a child would open real connections to Slack and Discord.
//
// `start` is a parameter, so the day a task genuinely needs OS processes it
// supplies a starter that spawns them, and nothing else here changes.
//
// **`startProxy`, never `runProxy`, is the default.** `runProxy` registers a
// `process.once` handler per call and the module's own entry branch calls
// `process.exit`; N instances would double-register both onto the test runner.

import {
  type ProxyConfig,
  type RunningProxy,
  type StartProxyOverrides,
  startProxy,
} from '../runtime/index.js';

export type StartProxyFn = (
  config: ProxyConfig,
  overrides?: StartProxyOverrides,
) => Promise<RunningProxy>;

export interface ProxyInstanceSpec {
  /** How tests address this instance. Must be unique within the cluster. */
  readonly name: string;
  readonly config: ProxyConfig;
  /**
   * Passed through untouched. The cluster never decides an instance's seams
   * itself: 11.4 needs the REAL platform facade on the instances whose
   * ownership it checks, and a fake on the ones it only posts through.
   */
  readonly overrides?: StartProxyOverrides;
}

export interface ProxyInstance {
  readonly name: string;
  readonly proxy: RunningProxy;
}

export interface ProxyCluster {
  /** The instances still running, in the order they were started. */
  readonly names: () => ReadonlyArray<string>;
  readonly get: (name: string) => ProxyInstance;
  /** Stops one instance. Doing nothing when it is already stopped. */
  readonly stop: (name: string) => Promise<void>;
  /** Stops every remaining instance, reporting the first failure afterwards. */
  readonly stopAll: () => Promise<void>;
}

export interface ProxyClusterDeps {
  readonly start?: StartProxyFn;
}

export const startProxyCluster = async (
  specs: ReadonlyArray<ProxyInstanceSpec>,
  deps: ProxyClusterDeps = {},
): Promise<ProxyCluster> => {
  const { start = startProxy } = deps;

  const duplicate = specs.find(
    (spec, index) =>
      specs.findIndex((other) => other.name === spec.name) < index,
  );
  if (duplicate != null) {
    throw new Error(`two cluster instances are both named '${duplicate.name}'`);
  }

  const running = new Map<string, ProxyInstance>();

  const stopOne = async (instance: ProxyInstance): Promise<void> => {
    running.delete(instance.name);
    await instance.proxy.stop();
  };

  /** Every instance still up, oldest first. Rebuilt per call, never held. */
  const remaining = (): ReadonlyArray<ProxyInstance> => [...running.values()];

  const stopEveryRemaining = async (): Promise<void> => {
    let firstFailure: unknown = null;
    for (const instance of remaining()) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one instance must be fully let go of before the next, so a shared lock is never released twice over
        await stopOne(instance);
      } catch (error) {
        // Recorded, not rethrown yet: an instance that will not stop must not
        // leave the ones after it holding locks and connections.
        firstFailure ??= error;
      }
    }
    if (firstFailure != null) throw firstFailure;
  };

  for (const spec of specs) {
    let proxy: RunningProxy;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: instances are started one at a time so the one that fails is unambiguous
      proxy = await start(spec.config, spec.overrides);
    } catch (error) {
      // The instances already up would otherwise keep their locks for as long
      // as the grant lasts, and the next test would fail for a reason that has
      // nothing to do with what it checks.
      await stopEveryRemaining().catch(() => undefined);
      throw error;
    }
    running.set(spec.name, { name: spec.name, proxy });
  }

  return {
    names: () => remaining().map((instance) => instance.name),

    get: (name) => {
      const instance = running.get(name);
      if (instance == null) {
        throw new Error(`this cluster has no running instance named '${name}'`);
      }
      return instance;
    },

    stop: async (name) => {
      const instance = running.get(name);
      if (instance == null) {
        throw new Error(`this cluster has no running instance named '${name}'`);
      }
      await stopOne(instance);
    },

    stopAll: stopEveryRemaining,
  };
};
