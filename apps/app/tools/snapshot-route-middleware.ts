/**
 * Snapshot apiv3 route middleware chains for ESM migration Phase 0 baseline.
 *
 * This tool boots Crowi, walks `app._router.stack`, and records every leaf
 * route under the apiv3 mount point (`/_api/v3/**`) as
 * `{ method, path, middlewares: string[] }`. The output is written as a
 * deterministic JSON document so Phase 3.8.c can diff against the post-ESM
 * snapshot to detect authorization bypass regressions.
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
 *
 * Requirements covered: 2.6, 2.8
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Crowi from '../src/server/crowi';

const APIV3_MOUNT_PREFIX = '/_api/v3';
const DEFAULT_OUTPUT =
  '.kiro/specs/esm-migration/route-middleware-baseline.json';

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

/**
 * Extract the static prefix that a mount Layer's regexp matches.
 * Express 4 stores the `regexp` source for `app.use('/prefix', router)` as
 * `/^\/prefix\/?(?=\/|$)/i`; `fast_slash` is true for unprefixed `app.use(router)`.
 */
function extractMountPrefix(layer: ExpressLayer): string {
  if (layer.path != null && typeof layer.path === 'string') {
    return layer.path;
  }
  if (layer.regexp?.fast_slash) {
    return '';
  }
  const source = layer.regexp?.source ?? '';
  // Source shape: "^\/foo\/?(?=\/|$)" — strip anchors and look-ahead.
  const match = source.match(/^\^\\\/(.*)\\\/\?\(\?=\\\/\|\$\)$/);
  if (match != null) {
    return `/${match[1].replace(/\\\//g, '/')}`;
  }
  // Parameterized mounts (`/users/:id`) include ([^\/]+?). Preserve the
  // source so diff is still stable, but mark it so reviewers can spot it.
  return `<regexp:${source}>`;
}

function isAnonymous(name: string): boolean {
  return name === '' || name === 'anonymous' || name === '<anonymous>';
}

type ExpressLayer = {
  name?: string;
  path?: string;
  regexp?: { source: string; fast_slash?: boolean };
  route?: {
    path: string | RegExp | Array<string | RegExp>;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name?: string }; name?: string; method?: string }>;
  };
  handle:
    | { stack?: ExpressLayer[]; name?: string }
    | ((...args: unknown[]) => unknown);
};

function walkStack(
  stack: ExpressLayer[],
  prefix: string,
  entries: RouteEntry[],
  violations: AnonymousViolation[],
): void {
  for (const layer of stack) {
    if (layer.route != null) {
      // Leaf route. The route.stack entries are per-handler Layer records.
      const routePath = Array.isArray(layer.route.path)
        ? layer.route.path.map(String).join('|')
        : String(layer.route.path);
      const fullPath = `${prefix}${routePath}`;

      const methods = Object.keys(layer.route.methods)
        .filter((k) => layer.route?.methods[k])
        .sort();

      for (const method of methods) {
        const middlewares: string[] = [];
        const routeLayers = layer.route.stack.filter(
          (l) =>
            l.method == null || l.method.toLowerCase() === method.toLowerCase(),
        );
        // The last layer is the route body (handler) itself. Middlewares in
        // the auth chain must have stable names for diff reliability, but
        // route bodies are inherently tied to their (path, method) slot and
        // are allowed to be anonymous inline arrow functions.
        const lastIndex = routeLayers.length - 1;
        routeLayers.forEach((rl, index) => {
          const handleName = (rl.handle?.name ?? '').trim();
          const layerName = (rl.name ?? '').trim();
          const effective = handleName !== '' ? handleName : layerName;
          middlewares.push(effective === '' ? '' : effective);

          const isMiddlewareSlot = index !== lastIndex;
          if (
            fullPath.startsWith(APIV3_MOUNT_PREFIX) &&
            isMiddlewareSlot &&
            isAnonymous(effective)
          ) {
            violations.push({
              method: method.toUpperCase(),
              path: fullPath,
              position: index,
            });
          }
        });

        if (fullPath.startsWith(APIV3_MOUNT_PREFIX)) {
          entries.push({
            method: method.toUpperCase(),
            path: fullPath,
            middlewares,
          });
        }
      }
      continue;
    }

    // Mount layer: recurse if the handle exposes its own router stack.
    const handle = layer.handle as { stack?: ExpressLayer[] } | undefined;
    if (handle?.stack != null && Array.isArray(handle.stack)) {
      const nestedPrefix = extractMountPrefix(layer);
      walkStack(handle.stack, `${prefix}${nestedPrefix}`, entries, violations);
    }
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
    // biome-ignore lint/suspicious/noExplicitAny: Express internal router typing.
    const router = (growi.express as any)._router as
      | { stack: ExpressLayer[] }
      | undefined;
    if (router == null || !Array.isArray(router.stack)) {
      throw new Error(
        'Express _router.stack is not available. Routes may not be attached.',
      );
    }

    const entries: RouteEntry[] = [];
    const violations: AnonymousViolation[] = [];
    walkStack(router.stack, '', entries, violations);

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
