/**
 * Snapshot apiv3 route middleware chains (structural authorization baseline).
 *
 * This tool boots Crowi, walks `app._router.stack`, and records every leaf
 * route under the apiv3 mount point (`/_api/v3/**`) as
 * `{ method, path, middlewares: string[] }`. The output is written as a
 * deterministic JSON document so a re-capture after a refactor can be diffed
 * against it to detect authorization bypass regressions. See the
 * "Authorization Regression Check" section of the app-commands skill.
 *
 * Design notes:
 * - The walker FAILS if any apiv3 **middleware** (any layer before the route
 *   body) is anonymous. A missing `handle.name` value destroys the semantic
 *   meaning of the diff (every anonymous would look identical), so the tool
 *   refuses to emit a baseline that is not verifiable. Fix the source by
 *   naming the factory return function and re-run.
 * - The final layer in each chain is the route body itself and is pinned to
 *   its (path, method) slot, so anonymous inline arrow handlers there are
 *   recorded verbatim as `''` and excluded from the guard. Reordering or
 *   replacing such a handler is still detected by a diff of the `middlewares`
 *   array.
 * - The implementation avoids `__dirname` / `__filename` and resolves the
 *   output file via `process.cwd()` + CLI flag, so it works under CJS and
 *   future ESM runners without refactoring.
 * - Metadata fields (`capturedAt`, `git`, `node`) are separated from the
 *   sortable `entries[]` payload so diffs remain byte-stable across reruns.
 *   Only `entries[]` is signal; the metadata changes on every run.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Crowi from '../src/server/crowi';
import {
  listRegisteredRoutes,
  type RegisteredRoute,
} from '../src/test-utils/express-route-walker';

const APIV3_MOUNT_PREFIX = '/_api/v3';
const DEFAULT_OUTPUT = 'tools/authz-matrix/baselines/route-middleware.json';

type RouteEntry = {
  method: string;
  path: string;
  middlewares: string[];
};

type AnonymousViolation = {
  method: string;
  path: string;
  /** 0-based index inside the leaf middleware chain */
  position: number;
};

type SnapshotEnvelope = {
  capturedAt: string;
  node: string;
  git: string;
  entryCount: number;
  entries: RouteEntry[];
};

function isAnonymous(name: string): boolean {
  return name === '' || name === 'anonymous' || name === '<anonymous>';
}

function collectApiv3Entries(
  routes: readonly RegisteredRoute[],
  entries: RouteEntry[],
  violations: AnonymousViolation[],
): void {
  for (const route of routes) {
    if (!route.path.startsWith(APIV3_MOUNT_PREFIX)) continue;

    // The last layer is the route body (handler) itself. Middlewares in
    // the auth chain must have stable names for diff reliability, but
    // route bodies are inherently tied to their (path, method) slot and
    // are allowed to be anonymous inline arrow functions.
    const lastIndex = route.middlewareNames.length - 1;
    route.middlewareNames.forEach((name, index) => {
      if (index !== lastIndex && isAnonymous(name)) {
        violations.push({
          method: route.method,
          path: route.path,
          position: index,
        });
      }
    });

    entries.push({
      method: route.method,
      path: route.path,
      middlewares: [...route.middlewareNames],
    });
  }
}

function resolveGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function parseOutputPath(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith('--out='));
  if (flag != null) {
    return flag.slice('--out='.length);
  }
  const idx = argv.indexOf('--out');
  if (idx !== -1 && argv[idx + 1] != null) {
    return argv[idx + 1];
  }
  return DEFAULT_OUTPUT;
}

async function main(): Promise<void> {
  const outputPath = resolve(
    process.cwd(),
    parseOutputPath(process.argv.slice(2)),
  );

  // Boot just enough of Crowi to attach all routes. We intentionally skip
  // `nextApp.prepare()` and `http.listen()` — neither influences the router
  // graph we are snapshotting, and both are slow / port-binding side effects
  // we don't want in an analysis tool.
  // biome-ignore lint/suspicious/noConsole: Progress log for long-running boot.
  console.log('[snapshot-route-middleware] instantiating Crowi...');
  const growi = new Crowi();
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[snapshot-route-middleware] running Crowi.init()...');
  await growi.init();
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[snapshot-route-middleware] running Crowi.buildServer()...');
  await growi.buildServer();

  // `routes/next.ts` calls `crowi.nextApp.getRequestHandler()` during route
  // registration. We never dispatch any request through this handler, but
  // the function reference itself ends up on the router stack and must be
  // a named function so the anonymous-middleware guard can evaluate it.
  // Substituting a minimal stub keeps the router graph identical to prod
  // without requiring a Next.js build.
  function nextRequestHandlerStub(): void {
    throw new Error(
      'snapshot-route-middleware: Next.js request handler is not available ' +
        'in analysis mode. This stub should never be invoked.',
    );
  }
  // biome-ignore lint/suspicious/noExplicitAny: Minimal nextApp stub for snapshot tool.
  (growi as any).nextApp = {
    getRequestHandler: () => nextRequestHandlerStub,
  };

  // Re-implement the relevant fragment of Crowi.start() inline.
  // The surface here must remain in lock-step with crowi/index.ts:615-617.
  growi.setupRoutesForPlugins();
  await growi.setupRoutesAtLast();

  try {
    const routes = listRegisteredRoutes(
      // biome-ignore lint/suspicious/noExplicitAny: Express internal router access.
      growi.express as any,
    );
    const entries: RouteEntry[] = [];
    const violations: AnonymousViolation[] = [];
    collectApiv3Entries(routes, entries, violations);

    if (violations.length > 0) {
      // biome-ignore lint/suspicious/noConsole: Tool script surfaces diagnostics.
      console.error(
        `\n[snapshot-route-middleware] ERROR: ${violations.length} anonymous middleware reference(s) detected in the apiv3 chain.\n` +
          'The baseline cannot be trusted with anonymous handlers because every unnamed function looks identical in a diff.\n' +
          'Fix the offending middleware factories to return NAMED functions, then re-run.\n\n' +
          'Offending entries:',
      );
      for (const v of violations) {
        // biome-ignore lint/suspicious/noConsole: Tool script surfaces diagnostics.
        console.error(
          `  ${v.method.padEnd(7)} ${v.path}  [position ${v.position}]`,
        );
      }
      process.exitCode = 2;
      return;
    }

    entries.sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
    });

    const envelope: SnapshotEnvelope = {
      capturedAt: new Date().toISOString(),
      node: process.version,
      git: resolveGitSha(),
      entryCount: entries.length,
      entries,
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

    // biome-ignore lint/suspicious/noConsole: Tool script surfaces diagnostics.
    console.log(
      `[snapshot-route-middleware] captured ${entries.length} apiv3 leaf endpoint(s) -> ${outputPath}`,
    );
  } finally {
    // Tear down side effects we introduced (DB connection, cron jobs, socket.io).
    // The process is expected to exit after this.
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {
      /* best-effort */
    });
  }

  // Force-exit because init() starts background timers (cron, socket.io)
  // that otherwise keep the event loop alive indefinitely.
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: Tool script surfaces diagnostics.
  console.error('[snapshot-route-middleware] failed', err);
  process.exit(1);
});
