/**
 * WebSocket authorization matrix capture (task 0.3.2).
 *
 * The structural route-middleware snapshot (0.3) and the apiv3 black-box
 * matrix (0.3.1) both operate on Express's internal router stack. Neither
 * observes the WebSocket upgrade gates — `service/yjs/upgrade-handler.ts`
 * (HTTP `upgrade` listener, not an Express middleware) and the socket.io
 * namespace middleware chain inside `service/socket-io/socket-io.ts`.
 *
 * This driver exercises the real upgrade path by booting Crowi with a
 * live HTTP listener, performing a genuine express-session login, and
 * opening raw `ws` / `socket.io-client` connections with the resulting
 * cookie. The observed statuses (4xx rejections, 101 accept + Yjs sync)
 * are written to `.kiro/specs/esm-migration/ws-authz-baseline.json` so
 * Phase 3.8.d can diff post-migration runs against it.
 *
 * Three yjs cases, three socket.io cases:
 *
 *   yjs/`no-session`         — WS connect with no cookie
 *   yjs/`session-unviewable` — cookie + pageId the user cannot view
 *   yjs/`session-viewable`   — cookie + pageId the user can view (101 + Yjs sync)
 *
 *   socketio/`no-session`         — connect with no cookie → loginRequired rejects
 *   socketio/`session-nonadmin-admin-ns` —
 *           cookie of a non-admin user connecting to the `/admin` namespace
 *           → adminRequired rejects. Note: the task spec asks for
 *           "session + unviewable" as the 2nd case, but socket.io has NO
 *           per-page ACL at connect time (the only namespace-level gate
 *           besides loginRequired is adminRequired on `/admin`), so we
 *           substitute the nearest real gate and document it here.
 *   socketio/`session-viewable`   — cookie on default `/` namespace → connect ok
 *
 * Output shape is flat and sorted-key-friendly so diffs in Phase 3.8.d
 * are unambiguous per field. Determinism is verified by two consecutive
 * passes (only the `capturedAt` / `git` / `node` metadata fields differ).
 *
 * Requirements covered: 2.6, 6.5
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { WebSocket } from 'ws';

import Crowi from '../src/server/crowi';
import {
  loginAndExtractCookie,
  seedWsFixtures,
  type WsSeededFixtures,
} from './authz-matrix/ws-fixtures';

const DEFAULT_OUTPUT = '.kiro/specs/esm-migration/ws-authz-baseline.json';

type YjsCaseResult = {
  readonly status: number;
  readonly syncReceived: boolean;
  readonly notes: string;
};

type SocketIoCaseResult = {
  readonly connected: boolean;
  readonly errorMessage: string | null;
  readonly notes: string;
};

type WsAuthzEnvelope = {
  readonly capturedAt: string;
  readonly node: string;
  readonly git: string;
  readonly yjs: {
    readonly 'no-session': YjsCaseResult;
    readonly 'session-unviewable': YjsCaseResult;
    readonly 'session-viewable': YjsCaseResult;
  };
  readonly socketio: {
    readonly 'no-session': SocketIoCaseResult;
    readonly 'session-nonadmin-admin-ns': SocketIoCaseResult;
    readonly 'session-viewable': SocketIoCaseResult;
  };
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

/**
 * Open a raw WebSocket against `ws://127.0.0.1:<port>/yjs/<pageId>` and
 * resolve with the observed outcome. We do NOT use a WS library that
 * swallows the HTTP response status on failed upgrade — we need the
 * actual 4xx / 101 that the server wrote.
 *
 * Behavior mapped to fields:
 *   - status:       the HTTP status the server responded to Upgrade with
 *                   (101 on accept, 401 / 403 on reject, 400 on malformed URL)
 *   - syncReceived: true iff the server sent at least one binary frame
 *                   within `syncGraceMs` (proves the Yjs handler on the
 *                   accepted socket is actually wired — not just the
 *                   upgrade handshake)
 */
async function observeYjsUpgrade(
  port: number,
  pageId: string,
  cookieHeader: string | null,
  syncGraceMs = 1500,
): Promise<{ status: number; syncReceived: boolean }> {
  return new Promise((resolvePromise) => {
    const headers: Record<string, string> = {};
    if (cookieHeader != null) {
      headers.Cookie = cookieHeader;
    }

    const ws = new WebSocket(`ws://127.0.0.1:${port}/yjs/${pageId}`, {
      headers,
    });

    let settled = false;
    let capturedStatus = 0;
    let syncReceived = false;
    let syncTimer: NodeJS.Timeout | null = null;

    const finish = (status: number, sync: boolean) => {
      if (settled) return;
      settled = true;
      if (syncTimer != null) clearTimeout(syncTimer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolvePromise({ status, syncReceived: sync });
    };

    // `upgrade` fires on 101 — we capture the status and arm the
    // sync-grace window. y-websocket sends an initial sync step 1 frame
    // as soon as the connection opens, so if we receive any binary
    // message within the grace window we have confirmation that the
    // server-side Yjs handler is actually bound to this socket.
    ws.on('upgrade', (res) => {
      capturedStatus = res.statusCode ?? 0;
    });

    ws.on('open', () => {
      // Already upgraded; wait for a Yjs sync message.
      syncTimer = setTimeout(() => {
        finish(capturedStatus || 101, syncReceived);
      }, syncGraceMs);
    });

    ws.on('message', (data) => {
      // Any binary message on an accepted /yjs/ connection = Yjs traffic.
      if (data instanceof Buffer || data instanceof ArrayBuffer) {
        syncReceived = true;
      } else if (Array.isArray(data) && data.length > 0) {
        syncReceived = true;
      }
    });

    // On reject the server writes `HTTP/1.1 <status> <msg>\r\n\r\n` and
    // the `ws` client surfaces this as an `unexpected-response` event
    // carrying the parsed HTTP response.
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      finish(res.statusCode ?? 0, false);
    });

    ws.on('error', () => {
      // Socket was destroyed mid-handshake without a parsed HTTP status.
      if (!settled && capturedStatus === 0) {
        finish(-1, false);
      }
    });

    ws.on('close', () => {
      finish(capturedStatus || -1, syncReceived);
    });

    // Hard cap on the whole observation to keep the capture bounded.
    setTimeout(() => finish(capturedStatus || -1, syncReceived), 5000);
  });
}

/**
 * Open a socket.io-client connection to the given namespace and resolve
 * with `connected: true` on successful `connect` event, or
 * `connected: false` with the `connect_error` message when the server
 * rejects the handshake via a namespace middleware.
 *
 * socket.io-client is loaded lazily so this driver does not pay the cost
 * when we're only running yjs cases.
 */
async function observeSocketIoConnect(
  port: number,
  namespace: string,
  cookieHeader: string | null,
  waitMs = 2500,
): Promise<{ connected: boolean; errorMessage: string | null }> {
  const { io } = await import('socket.io-client');

  return new Promise((resolvePromise) => {
    const extraHeaders: Record<string, string> = {};
    if (cookieHeader != null) {
      extraHeaders.Cookie = cookieHeader;
    }

    // transports:['websocket'] avoids the XHR polling upgrade path and
    // makes the observed failure mode deterministic (single handshake
    // attempt, single rejection).
    const socket = io(`http://127.0.0.1:${port}${namespace}`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: waitMs,
      extraHeaders,
    });

    let settled = false;
    const finish = (connected: boolean, errorMessage: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      resolvePromise({ connected, errorMessage });
    };

    socket.on('connect', () => finish(true, null));
    socket.on('connect_error', (err: Error) => {
      finish(false, err?.message ?? String(err));
    });

    // Hard cap so a misbehaving handler does not stall the capture.
    setTimeout(() => finish(false, 'timeout'), waitMs + 500);
  });
}

type CaptureData = Omit<WsAuthzEnvelope, 'capturedAt' | 'node' | 'git'>;

async function runCapturePass(
  port: number,
  fixtures: WsSeededFixtures,
): Promise<CaptureData> {
  // Log in once per pass. A fresh pass opens a new session so cookie
  // lifecycles stay independent across passes.
  const login = await loginAndExtractCookie(
    port,
    fixtures.username,
    fixtures.password,
  );
  if (login.status !== 200) {
    throw new Error(
      `[ws-authz] login failed with status ${login.status}; cannot derive a session cookie`,
    );
  }
  const cookie = login.cookie;

  const viewablePageId = fixtures.viewablePageId.toHexString();
  const unviewablePageId = fixtures.unviewablePageId.toHexString();

  // Case 1 targets the unviewable page to actually exercise the auth
  // gate. Targeting the viewable (GRANT_PUBLIC) page would return 101
  // even without a cookie because PUBLIC pages are viewable to null
  // users (that is a correct authorization decision, not an auth
  // bypass). The baseline is meaningful only when each case distinguishes
  // a specific gate decision.
  const yjsNoSession = await observeYjsUpgrade(port, unviewablePageId, null);
  const yjsSessionUnviewable = await observeYjsUpgrade(
    port,
    unviewablePageId,
    cookie,
  );
  const yjsSessionViewable = await observeYjsUpgrade(
    port,
    viewablePageId,
    cookie,
  );

  const sioNoSession = await observeSocketIoConnect(port, '/', null);
  const sioNonAdminOnAdminNs = await observeSocketIoConnect(
    port,
    '/admin',
    cookie,
  );
  const sioSessionViewable = await observeSocketIoConnect(port, '/', cookie);

  return {
    yjs: {
      'no-session': {
        status: yjsNoSession.status,
        syncReceived: yjsNoSession.syncReceived,
        notes:
          'No Cookie header on upgrade; targets the unviewable page (GRANT_OWNER) so the null-user ACL check rejects.',
      },
      'session-unviewable': {
        status: yjsSessionUnviewable.status,
        syncReceived: yjsSessionUnviewable.syncReceived,
        notes:
          'Valid session cookie; page grant=GRANT_OWNER owned by a different user. isAccessiblePageByViewer returns false.',
      },
      'session-viewable': {
        status: yjsSessionViewable.status,
        syncReceived: yjsSessionViewable.syncReceived,
        notes:
          'Valid session cookie; page grant=GRANT_PUBLIC. Expect 101 + at least one Yjs sync frame within the grace window.',
      },
    },
    socketio: {
      'no-session': {
        connected: sioNoSession.connected,
        errorMessage: sioNoSession.errorMessage,
        notes:
          'Default namespace "/"; no cookie. loginRequired middleware (setupLoginRequiredMiddleware) rejects before connect.',
      },
      'session-nonadmin-admin-ns': {
        connected: sioNonAdminOnAdminNs.connected,
        errorMessage: sioNonAdminOnAdminNs.errorMessage,
        notes:
          'Admin namespace "/admin"; cookie of a non-admin user. adminRequired middleware (setupAdminRequiredMiddleware) rejects. Substituted for the "session-unviewable" case because socket.io has no per-page ACL at connect time.',
      },
      'session-viewable': {
        connected: sioSessionViewable.connected,
        errorMessage: sioSessionViewable.errorMessage,
        notes:
          'Default namespace "/"; valid non-admin session. All middlewares (loginRequired, connection limits) pass.',
      },
    },
  };
}

function serializeForComparison(data: CaptureData): string {
  // Stable string representation used for determinism checks. The error
  // message text is observation-only — we expect it to be stable because
  // the middleware error messages are literal strings, but we still
  // include it so any drift surfaces.
  return JSON.stringify(data);
}

async function main(): Promise<void> {
  // Silence unhandled rejections from downstream modules (same rationale
  // as the apiv3 matrix driver — this is a standalone tool).
  process.on('uncaughtException', (err) => {
    // biome-ignore lint/suspicious/noConsole: Diagnostic.
    console.error(
      '[ws-authz] swallowed uncaughtException during capture:',
      (err as Error)?.message ?? err,
    );
  });
  process.on('unhandledRejection', (reason) => {
    // biome-ignore lint/suspicious/noConsole: Diagnostic.
    console.error(
      '[ws-authz] swallowed unhandledRejection during capture:',
      (reason as Error)?.message ?? reason,
    );
  });

  const argv = process.argv.slice(2);
  const outputPath = resolve(
    process.cwd(),
    parseFlag(argv, '--out', DEFAULT_OUTPUT),
  );
  const portFlag = parseFlag(argv, '--port', '13000');
  const port = Number.parseInt(portFlag, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(
      `[ws-authz] --port must be a positive integer (got ${portFlag})`,
    );
  }
  const verifyTwice = argv.includes('--verify-determinism');

  const growi = new Crowi();
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[ws-authz] running Crowi.init()...');
  await growi.init();
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[ws-authz] running Crowi.buildServer()...');
  await growi.buildServer();

  // Force the installation flag so `applicationInstalled` middleware
  // allows POST /_api/v3/login through. Same trick as the apiv3 matrix
  // driver; avoids running the full InstallerService.
  await growi.configManager.updateConfigs({ 'app:installed': true });

  // Seed fixtures BEFORE routes so the user + pages exist when the
  // login request arrives.
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[ws-authz] seeding fixtures...');
  const fixtures = await seedWsFixtures(growi);

  // Next.js delegator stub — routes/index.js wires `next.delegateToNext`
  // to several non-apiv3 paths (e.g. GET /login, GET /). We never dispatch
  // to those in this capture, but setupRoutes() calls getRequestHandler()
  // during registration so the stub must be installed before routes run.
  function nextRequestHandlerStub(): void {
    throw new Error(
      '[ws-authz] Next.js request handler is not available in capture mode.',
    );
  }
  // biome-ignore lint/suspicious/noExplicitAny: Minimal nextApp stub.
  (growi as any).nextApp = {
    getRequestHandler: () => nextRequestHandlerStub,
  };

  // Build routes (including /_api/v3/login).
  growi.setupRoutesForPlugins();
  await growi.setupRoutesAtLast();

  // Create the HTTP server, attach socket.io + yjs, and start listening.
  // biome-ignore lint/suspicious/noExplicitAny: express typing.
  const app = (growi as any).express;
  const httpServer = http.createServer(app);

  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log('[ws-authz] attaching socket.io and yjs to HTTP server...');
  await growi.socketIoService.attachServer(httpServer);
  // Dynamic import to stay in lockstep with how Crowi.start() wires yjs;
  // static imports would pull the initializer singleton guard earlier than
  // intended.
  const { initializeYjsService } = await import('../src/server/service/yjs');
  initializeYjsService(
    httpServer,
    growi.socketIoService.io,
    growi.sessionConfig,
  );

  await new Promise<void>((resolvePromise, rejectPromise) => {
    httpServer.once('error', rejectPromise);
    httpServer.listen(port, '127.0.0.1', () => resolvePromise());
  });
  // biome-ignore lint/suspicious/noConsole: Progress log.
  console.log(`[ws-authz] HTTP listener up on 127.0.0.1:${port}`);

  let exitCode = 0;
  try {
    // biome-ignore lint/suspicious/noConsole: Progress log.
    console.log('[ws-authz] running first capture pass...');
    const firstPass = await runCapturePass(port, fixtures);

    let finalData = firstPass;
    if (verifyTwice) {
      // biome-ignore lint/suspicious/noConsole: Progress log.
      console.log(
        '[ws-authz] running second capture pass for determinism check...',
      );
      const secondPass = await runCapturePass(port, fixtures);
      const firstStr = serializeForComparison(firstPass);
      const secondStr = serializeForComparison(secondPass);
      if (firstStr !== secondStr) {
        // biome-ignore lint/suspicious/noConsole: Diagnostic.
        console.error(
          '[ws-authz] ERROR: capture is non-deterministic across two consecutive passes.',
        );
        // biome-ignore lint/suspicious/noConsole: Diagnostic.
        console.error(`  PASS-A: ${firstStr}`);
        // biome-ignore lint/suspicious/noConsole: Diagnostic.
        console.error(`  PASS-B: ${secondStr}`);
        exitCode = 2;
      }
      finalData = secondPass;
    }

    const envelope: WsAuthzEnvelope = {
      capturedAt: new Date().toISOString(),
      node: process.version,
      git: resolveGitSha(),
      ...finalData,
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

    // biome-ignore lint/suspicious/noConsole: Progress log.
    console.log(`[ws-authz] wrote ${outputPath}`);
  } finally {
    // Tear everything down cleanly so the tool exits.
    await new Promise<void>((resolvePromise) => {
      httpServer.close(() => resolvePromise());
    }).catch(() => {
      /* best-effort */
    });
    try {
      growi.socketIoService.io.close();
    } catch {
      /* best-effort */
    }
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {
      /* best-effort */
    });
  }

  process.exit(exitCode);
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: Tool script surfaces diagnostics.
  console.error('[ws-authz] failed', err);
  process.exit(1);
});
