/**
 * Black-box authorization matrix capture for the apiv3 surface.
 *
 * This complements the structural route-middleware snapshot (task 0.3) by
 * observing the *runtime* authorization response for every apiv3 leaf
 * endpoint × {unauthenticated / guest / readonly / admin} persona. The
 * structural snapshot cannot detect the following regression classes:
 *
 *   - Inline `express.Router()` guards added via anonymous middleware
 *   - Anonymous arrow-fn middleware that happens to match a prior name
 *   - Mongoose model acquisition order differences that skip a guard
 *
 * The matrix baseline records the observed HTTP status code per cell, not
 * the business-logic validity of the response. A missing request body may
 * produce a 400 after the auth gate passes — that is fine and deterministic
 * because the diff in phase 3.8.c is checking for *auth status* drift.
 *
 * Output file (deterministic, sorted by path then method):
 *   .kiro/specs/esm-migration/authz-matrix-baseline.json
 *
 * Requirements covered: 2.6, 2.8, 6.5
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Express } from 'express';
import supertest from 'supertest';

import Crowi from '../src/server/crowi';
import {
  PERSONA_NAMES,
  type PersonaName,
  registerPersonaInjector,
  seedPersonas,
  TEST_PERSONA_HEADER,
} from './authz-matrix/personas';

const APIV3_MOUNT_PREFIX = '/_api/v3';
const DEFAULT_INPUT =
  '.kiro/specs/esm-migration/route-middleware-baseline.json';
const DEFAULT_OUTPUT = '.kiro/specs/esm-migration/authz-matrix-baseline.json';

type StructuralEntry = {
  method: string;
  path: string;
  middlewares: string[];
};

type StructuralEnvelope = {
  entries: StructuralEntry[];
};

type MatrixRow = {
  method: string;
  path: string;
  unauthenticated: number;
  guest: number;
  readonly: number;
  admin: number;
};

type MatrixEnvelope = {
  capturedAt: string;
  node: string;
  git: string;
  personaHeader: string;
  entryCount: number;
  matrix: MatrixRow[];
};

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

function parseFlag(argv: string[], name: string, fallback: string): string {
  const prefixed = argv.find((a) => a.startsWith(`${name}=`));
  if (prefixed != null) {
    return prefixed.slice(name.length + 1);
  }
  const idx = argv.indexOf(name);
  if (idx !== -1 && argv[idx + 1] != null) {
    return argv[idx + 1];
  }
  return fallback;
}

function loadStructuralEntries(inputPath: string): StructuralEntry[] {
  const buf = readFileSync(inputPath, 'utf8');
  const doc = JSON.parse(buf) as StructuralEnvelope;
  if (doc.entries == null || !Array.isArray(doc.entries)) {
    throw new Error(
      `[authz-matrix] ${inputPath} is missing a valid 'entries' array`,
    );
  }
  return doc.entries.filter((e) => e.path.startsWith(APIV3_MOUNT_PREFIX));
}

/**
 * Substitute Express path parameters with a deterministic synthetic value.
 * The baseline only cares about the *auth-gate* HTTP status, so the actual
 * identity of the id does not matter — what matters is that the substituted
 * path is syntactically complete so the route matches.
 */
function substitutePathParams(path: string): string {
  return path
    .replace(/:([A-Za-z0-9_]+)\([^)]*\)/g, '000000000000000000000001') // :id([0-9a-f]{24})
    .replace(/:([A-Za-z0-9_]+)\??/g, (_m, name: string) => {
      // Attachment-style 24-hex param → ObjectId-shaped.
      if (
        /id$/i.test(name) ||
        name.toLowerCase() === 'activityid' ||
        name.toLowerCase() === 'pageid' ||
        name.toLowerCase() === 'userid' ||
        name.toLowerCase() === 'id'
      ) {
        return '000000000000000000000001';
      }
      return 'synthetic';
    });
}

type SupertestMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options';

function methodForSupertest(method: string): SupertestMethod | null {
  const lower = method.toLowerCase();
  const supported: SupertestMethod[] = [
    'get',
    'post',
    'put',
    'delete',
    'patch',
    'options',
  ];
  return (supported as string[]).includes(lower)
    ? (lower as SupertestMethod)
    : null;
}

// Status sentinel for endpoints that crash with an uncaught exception
// BEFORE the server assigned a response status. We use 599 to stay inside
// the HTTP status code space while being distinguishable from any real
// server-generated status.
const STATUS_UNCAUGHT_EXCEPTION = 599;

async function dispatch(
  app: Express,
  method: string,
  path: string,
  persona: PersonaName,
): Promise<number> {
  const verb = methodForSupertest(method);
  if (verb == null) {
    // Record -1 for unsupported HTTP verbs; makes baseline explicit.
    return -1;
  }
  const substituted = substitutePathParams(path);

  const agent = supertest(app);
  // Force a short-circuit body for methods that expect one. We send `{}` so
  // express.json() parses successfully; subsequent validators may still 400.
  const requestor = agent[verb](substituted)
    .set(TEST_PERSONA_HEADER, persona)
    // Set accept so error paths prefer JSON over HTML redirects where it
    // matters. Some routes redirect unauthenticated -> /login regardless.
    .set('Accept', 'application/json')
    // Cap each request at 5s so a hanging async handler does not freeze
    // the capture forever. Unfinished requests count as 599.
    .timeout({ deadline: 5000 });

  try {
    const res =
      verb === 'post' || verb === 'put' || verb === 'patch' || verb === 'delete'
        ? await requestor.send({})
        : await requestor;
    return res.status;
  } catch {
    // Route handler threw synchronously, rejected asynchronously, or
    // timed out before responding. Treat as 599 (post-auth crash) — the
    // auth gate clearly was not the cause because an unauthenticated /
    // forbidden request short-circuits before the handler runs.
    return STATUS_UNCAUGHT_EXCEPTION;
  }
}

/**
 * Install an Express error handler (4-arg middleware) that converts any
 * error thrown synchronously by a route handler into a 599 response. This
 * is a capture-only behavior — production Crowi installs
 * `setupGlobalErrorHandlers()` in `start()`, which we intentionally skip
 * to keep boot fast and avoid interfering with the matrix observation.
 */
function registerCaptureErrorHandler(app: Express): void {
  app.use(function authzMatrixErrorHandler(
    _err: unknown,
    _req: unknown,
    // biome-ignore lint/suspicious/noExplicitAny: Express typing.
    res: any,
    // biome-ignore lint/suspicious/noExplicitAny: Express typing.
    _next: any,
  ) {
    if (!res.headersSent) {
      res.status(STATUS_UNCAUGHT_EXCEPTION).json({ authzMatrix: 'uncaught' });
    }
  });
}

async function runCapturePass(
  app: Express,
  // biome-ignore lint/suspicious/noExplicitAny: ConfigManager typing is deep.
  crowi: any,
  entries: StructuralEntry[],
): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];

  for (const persona of PERSONA_NAMES) {
    // Toggle the guest-read ACL per persona pass so the guest column diverges
    // from the unauthenticated column. Authenticated personas are unaffected
    // by this setting because `loginRequired` consults the ACL only when
    // `req.user == null`.
    const guestAllowed = persona === 'guest';
    await crowi.configManager.updateConfigs({
      'security:restrictGuestMode': guestAllowed ? 'Readonly' : 'Deny',
    });
  }

  // After priming, keep guest-ACL off (unauthenticated default).
  await crowi.configManager.updateConfigs({
    'security:restrictGuestMode': 'Deny',
  });

  // Build rows keyed by (path, method).
  const key = (e: StructuralEntry) => `${e.path}|${e.method}`;
  const index = new Map<string, Partial<MatrixRow>>();
  for (const e of entries) {
    index.set(key(e), { method: e.method, path: e.path });
  }

  for (const persona of PERSONA_NAMES) {
    const guestAllowed = persona === 'guest';
    await crowi.configManager.updateConfigs({
      'security:restrictGuestMode': guestAllowed ? 'Readonly' : 'Deny',
    });

    for (const e of entries) {
      const status = await dispatch(app, e.method, e.path, persona);
      const row = index.get(key(e))!;
      (row as Record<PersonaName, number>)[persona] = status;
    }
  }

  // Materialize, sorting by (path, method) for diff stability.
  for (const [, partial] of index) {
    rows.push(partial as MatrixRow);
  }
  rows.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
  });

  return rows;
}

function serializeMatrix(rows: MatrixRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.path}|${r.method}|u=${r.unauthenticated}|g=${r.guest}|r=${r.readonly}|a=${r.admin}`,
    )
    .join('\n');
}

/**
 * Suppress Node's default "abort on uncaughtException / unhandledRejection"
 * behavior for the lifetime of the capture script. Route handlers that
 * reject after their supertest call already resolved would otherwise crash
 * the whole capture run and leave the baseline half-written.
 *
 * These handlers are PROCESS-WIDE and intentional; the driver is a
 * standalone tool and the production server has its own error handling
 * via `setupGlobalErrorHandlers()`.
 */
function installCaptureExceptionSink(): void {
  process.on('uncaughtException', (err) => {
    // biome-ignore lint/suspicious/noConsole: Diagnostic.
    console.error(
      '[authz-matrix] swallowed uncaughtException during capture:',
      (err as Error)?.message ?? err,
    );
  });
  process.on('unhandledRejection', (reason) => {
    // biome-ignore lint/suspicious/noConsole: Diagnostic.
    console.error(
      '[authz-matrix] swallowed unhandledRejection during capture:',
      (reason as Error)?.message ?? reason,
    );
  });
}

async function main(): Promise<void> {
  installCaptureExceptionSink();

  const argv = process.argv.slice(2);
  const outputPath = resolve(
    process.cwd(),
    parseFlag(argv, '--out', DEFAULT_OUTPUT),
  );
  const inputPath = resolve(
    process.cwd(),
    parseFlag(argv, '--in', DEFAULT_INPUT),
  );
  const verifyTwice = argv.includes('--verify-determinism');

  const entries = loadStructuralEntries(inputPath);

  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log(
    `[authz-matrix] loaded ${entries.length} apiv3 endpoints from ${inputPath}`,
  );

  const growi = new Crowi();
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[authz-matrix] running Crowi.init()...');
  await growi.init();
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[authz-matrix] running Crowi.buildServer()...');
  await growi.buildServer();

  // Next.js request handler stub — we never dispatch non-apiv3 paths to it,
  // but route registration pulls a reference.
  function nextRequestHandlerStub(): void {
    throw new Error(
      '[authz-matrix] Next.js request handler is not available in capture mode.',
    );
  }
  // biome-ignore lint/suspicious/noExplicitAny: Minimal nextApp stub.
  (growi as any).nextApp = {
    getRequestHandler: () => nextRequestHandlerStub,
  };

  // Force the installation flag so installation-gated routes match the
  // production baseline state instead of redirecting to /installer.
  await growi.configManager.updateConfigs({ 'app:installed': true });

  // Seed personas BEFORE registering the injector, then attach the injector
  // BEFORE routes so it wraps every apiv3 handler chain.
  // biome-ignore lint/suspicious/noExplicitAny: express typing.
  const app = (growi as any).express as Express;

  const seeded = await seedPersonas(growi);
  await registerPersonaInjector(app, growi, seeded);

  growi.setupRoutesForPlugins();
  await growi.setupRoutesAtLast();

  // Install the capture error handler AFTER routes so it sits at the end
  // of the stack and catches any exception thrown synchronously by a route
  // handler. Production Crowi relies on `setupGlobalErrorHandlers()` for
  // the same job, which we skip to keep boot fast.
  registerCaptureErrorHandler(app);

  try {
    const firstRows = await runCapturePass(app, growi, entries);

    let rows = firstRows;
    if (verifyTwice) {
      // biome-ignore lint/suspicious/noConsole: Progress log.
      console.log(
        '[authz-matrix] running second capture pass for determinism check...',
      );
      const secondRows = await runCapturePass(app, growi, entries);
      const firstSerialized = serializeMatrix(firstRows);
      const secondSerialized = serializeMatrix(secondRows);
      if (firstSerialized !== secondSerialized) {
        // biome-ignore lint/suspicious/noConsole: Diagnostic.
        console.error(
          '[authz-matrix] ERROR: matrix is non-deterministic across two consecutive runs.',
        );
        // Report divergence lines only (bounded).
        const aLines = firstSerialized.split('\n');
        const bLines = secondSerialized.split('\n');
        for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
          if (aLines[i] !== bLines[i]) {
            // biome-ignore lint/suspicious/noConsole: Diagnostic.
            console.error(`  PASS-A: ${aLines[i] ?? '(missing)'}`);
            // biome-ignore lint/suspicious/noConsole: Diagnostic.
            console.error(`  PASS-B: ${bLines[i] ?? '(missing)'}`);
          }
        }
        process.exitCode = 2;
        return;
      }
      rows = secondRows;
    }

    const envelope: MatrixEnvelope = {
      capturedAt: new Date().toISOString(),
      node: process.version,
      git: resolveGitSha(),
      personaHeader: TEST_PERSONA_HEADER,
      entryCount: rows.length,
      matrix: rows,
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

    // biome-ignore lint/suspicious/noConsole: Tool script surfaces diagnostics.
    console.log(
      `[authz-matrix] captured ${rows.length} rows × 4 personas -> ${outputPath}`,
    );
  } finally {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {
      /* best-effort */
    });
  }

  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: Tool script surfaces diagnostics.
  console.error('[authz-matrix] failed', err);
  process.exit(1);
});
