// The process itself: read the configuration, build the graph, put the body cap
// in front of the endpoints, listen, start reconciling connections, and give
// everything back when a signal arrives.
//
// **The HTTP listener is opened unconditionally.** The eight endpoints GROWI
// signs requests to, the OAuth callbacks and the pairing submission are all
// served over HTTP, whichever chat services this deployment has configured --
// whether any of them needs a hole opened from the internet
// (`REQUIRES_INBOUND_REACHABILITY`) is a different question entirely
// (tasks.md 9.1).

import { pathToFileURL } from 'node:url';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { createRoutesApp, type RoutesAppDeps } from '../routes/index.js';
import { loadConfig, type ProxyConfig } from './config.js';
import {
  createProxyDependencies,
  type ProxyDependencies,
  type ProxyDependencyOverrides,
} from './dependencies.js';

/**
 * How long shutdown waits for requests already in flight. Past it the listener
 * is abandoned rather than waited on: an exit that never comes is worse for the
 * operator than one request answered by the caller's own retry.
 */
export const SHUTDOWN_GRACE_MS = 10_000;

/** Every signal a supervisor uses to ask this process to stop. */
export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * The app that is actually served: the composed endpoints with the body cap in
 * front of all of them.
 *
 * The cap is registered on a wrapper rather than inside `createRoutesApp`
 * because it must apply to every endpoint including the unsigned ones, and
 * because the size is configuration -- which `routes/` cannot see. It comes
 * first so that `signatureGuard`, which reads the whole body before it can
 * verify anything, never holds a body an unauthenticated caller chose the size
 * of.
 */
export const createProxyApp = (
  deps: RoutesAppDeps,
  bodyLimitBytes: number,
): Hono => {
  const app = new Hono();
  app.use(
    '*',
    bodyLimit({
      maxSize: bodyLimitBytes,
      onError: (c) => c.body(null, 413),
    }),
  );
  app.route('/', createRoutesApp(deps));
  return app;
};

export interface ShutdownDeps {
  /** Stops accepting connections and resolves once requests in flight are done. */
  readonly closeHttp: () => Promise<void>;
  readonly shutdownDependencies: () => Promise<void>;
  readonly graceMs?: number;
}

/**
 * The teardown sequence, as a function that can be called more than once.
 *
 * Idempotent on purpose: a supervisor sends SIGTERM and then, when the process
 * has not gone away yet, SIGINT or a second SIGTERM. Running the sequence twice
 * would close a listener that is already closed and disconnect storage a second
 * time, so the first call owns it and every later one waits for that same
 * finish.
 */
export const createShutdown = (deps: ShutdownDeps): (() => Promise<void>) => {
  const graceMs = deps.graceMs ?? SHUTDOWN_GRACE_MS;
  let running: Promise<void> | null = null;

  const run = async (): Promise<void> => {
    // Bounded: `closeHttp` resolves when the last in-flight request finishes,
    // which a long-running one can delay indefinitely.
    await Promise.race([
      deps.closeHttp(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, graceMs);
        // Not a reason to keep the process alive -- it exists to let go of one.
        timer.unref?.();
      }),
    ]);
    await deps.shutdownDependencies();
  };

  return () => {
    running ??= run();
    return running;
  };
};

export interface RunningProxy {
  readonly dependencies: ProxyDependencies;
  readonly port: number;
  /** Runs the teardown sequence. Safe to call more than once. */
  readonly stop: () => Promise<void>;
}

export interface StartProxyOverrides extends ProxyDependencyOverrides {
  readonly listen?: (app: Hono, port: number) => ServerType;
}

/**
 * Builds everything, serves the endpoints and starts reconciling connections.
 *
 * Ordered so that nothing is served before it can be answered: the graph
 * (which includes creating the declared Mattermost installations) is built
 * first, the listener opens next, and reconciling connections comes last --
 * it is the only step whose failure a chat user notices rather than a caller.
 */
export const startProxy = async (
  config: ProxyConfig,
  overrides: StartProxyOverrides = {},
): Promise<RunningProxy> => {
  const { listen = (app, port) => serve({ fetch: app.fetch, port }), ...rest } =
    overrides;

  const dependencies = await createProxyDependencies(config, rest);
  const server = listen(
    createProxyApp(dependencies.routes, config.http.bodyLimitBytes),
    config.http.port,
  );

  await dependencies.facade.connections().start();
  // Last, and deliberately: a cycle re-takes channel inventories through the
  // chat connections, so starting it before they reconcile would spend its
  // first cycle failing.
  dependencies.sweeper.start();

  return {
    dependencies,
    port: config.http.port,
    stop: createShutdown({
      closeHttp: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error == null ? resolve() : reject(error)));
        }),
      // The periodic work stops FIRST -- before the connections and this app's
      // storage are given back. A cycle firing during teardown would reach a
      // state connection that is already closing, and would be holding the
      // sweep lock while it did, keeping every other instance out until the
      // grant expired. `createShutdown` runs this once however many signals
      // arrive, so the schedule is not taken down twice.
      shutdownDependencies: async () => {
        await dependencies.sweeper.stop();
        await dependencies.shutdown();
      },
    }),
  };
};

/**
 * Starts the proxy and ties its teardown to the signals a supervisor sends.
 *
 * `signals` and `onStopped` are parameters so the whole path is exercisable
 * without a real signal and without ending the test runner's own process.
 */
export const runProxy = async (
  overrides: StartProxyOverrides & {
    readonly config?: ProxyConfig;
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    readonly onStopped?: () => void;
  } = {},
): Promise<RunningProxy> => {
  const {
    config = loadConfig(),
    signals = SHUTDOWN_SIGNALS,
    onStopped,
    ...rest
  } = overrides;

  const proxy = await startProxy(config, rest);

  for (const signal of signals) {
    process.once(signal, () => {
      void proxy.stop().then(() => onStopped?.());
    });
  }

  return proxy;
};

// Started only when this file IS the process, never when it is imported --
// compared as a URL rather than as a path, because `import.meta.url` is one.
if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runProxy({ onStopped: () => process.exit(0) });
}
