/**
 * LoadDriver
 *
 * Composes http-client, installer-driver, and yjs-client into a single
 * interface for generating mixed load against a GROWI server:
 *
 *  - pageCreate  — POST /api/v3/page  (creates a new page each invocation)
 *  - pageEdit    — POST /api/v3/page  (creates a page with "edited" content)
 *  - pageGet     — GET  /api/v3/page  (fetches a page by path for markdown render)
 *  - pageList    — GET  /api/v3/pages/list (page tree walk)
 *  - pageSearch  — GET  /_api/search  (Elasticsearch full-text search)
 *  - yjsSessionCleanClose — connects to /yjs/{pageId} and closes cleanly
 *  - yjsSessionAbort      — connects to /yjs/{pageId} and terminates abruptly
 *
 * All write operations use the session established by initInstaller().
 *
 * Smoke-test entry point:
 *   tsx bin/memory-profiler/load-driver.ts --smoke
 */

import {
  createHttpClient,
  createInstallerDriver,
  createYjsSession,
} from './lib';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadDriver {
  initInstaller(): Promise<{
    adminEmail: string;
    adminPassword: string;
    cookie: string;
  }>;
  pageCreate(count: number): Promise<void>;
  pageEdit(count: number): Promise<void>;
  pageGet(count: number): Promise<void>;
  pageList(count: number): Promise<void>;
  pageSearch(count: number): Promise<void>;
  yjsSessionCleanClose(count: number): Promise<void>;
  yjsSessionAbort(count: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed query string used for pageSearch to ensure reproducibility (Req 2.5). */
const SEARCH_QUERY = 'profiling-test';

/** Base path used for load-driver pages so they are easily identifiable. */
const PAGE_BASE_PATH = '/load-driver-test';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new LoadDriver that targets the given GROWI server URL.
 *
 * @param baseUrl - HTTP base URL of the GROWI server, e.g. "http://localhost:3000".
 */
export function createLoadDriver(baseUrl: string): LoadDriver {
  // Derive the WebSocket base URL from the HTTP base URL.
  const wsBaseUrl = baseUrl.replace(/^http/, 'ws');

  const httpClient = createHttpClient({ baseUrl });
  const installerDriver = createInstallerDriver(httpClient);

  // Session state populated by initInstaller().
  // Stored as the name=value pair (without Set-Cookie attributes) so it can be
  // passed as a Cookie request header in WebSocket upgrade requests.
  let sessionCookie: string | undefined;

  // Tracks created page paths for use in pageGet operations.
  const createdPaths: string[] = [];
  // Tracks created page IDs (MongoDB ObjectIds) for Yjs WebSocket sessions.
  const createdIds: string[] = [];
  let pageCounter = 0;

  // -------------------------------------------------------------------------
  // initInstaller
  // -------------------------------------------------------------------------

  const initInstaller = async (): Promise<{
    adminEmail: string;
    adminPassword: string;
    cookie: string;
  }> => {
    const result = await installerDriver.initInstaller();
    // Store only the name=value portion (strip Set-Cookie attributes like Path, HttpOnly, etc.)
    // so it can be used as a Cookie request header in WebSocket upgrade requests.
    sessionCookie = result.cookie.split(';')[0];
    return result;
  };

  // -------------------------------------------------------------------------
  // pageCreate
  // -------------------------------------------------------------------------

  /**
   * Creates `count` pages via POST /api/v3/page.
   * Each page gets a unique path based on a monotonically increasing counter.
   */
  const pageCreate = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) {
      const idx = ++pageCounter;
      const path = `${PAGE_BASE_PATH}/page-${idx}-${Date.now()}`;
      const body = `# Load Driver Test Page ${idx}\n\nThis page was created by the memory-profiler load driver.`;

      // biome-ignore lint/performance/noAwaitInLoops: intentional serial execution — design mandates 直列発火
      const res = await httpClient.post('/_api/v3/page', {
        path,
        body,
        grant: 1, // Public
      });

      createdPaths.push(path);
      // Store the page _id for Yjs WebSocket sessions (which require a real ObjectId).
      const json = await res.json().catch(() => null);
      const pageId: string | undefined = json?.page?._id;
      if (pageId != null) {
        createdIds.push(pageId);
      }
    }
  };

  // -------------------------------------------------------------------------
  // pageEdit
  // -------------------------------------------------------------------------

  /**
   * Simulates page edits by creating new pages with "edited" content.
   *
   * Creating new pages is simpler and equally effective for the memory
   * profiling purpose: it ensures pages travel through the full create +
   * markdown-render code path without requiring a prior page to exist.
   */
  const pageEdit = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) {
      const idx = ++pageCounter;
      const path = `${PAGE_BASE_PATH}/edited-${idx}-${Date.now()}`;
      const body = `# Edited Page ${idx}\n\nThis simulates an edit operation in the memory-profiler load driver.`;

      // biome-ignore lint/performance/noAwaitInLoops: intentional serial execution — design mandates 直列発火
      const res = await httpClient.post('/_api/v3/page', {
        path,
        body,
        grant: 1,
      });

      createdPaths.push(path);
      const json = await res.json().catch(() => null);
      const pageId: string | undefined = json?.page?._id;
      if (pageId != null) {
        createdIds.push(pageId);
      }
    }
  };

  // -------------------------------------------------------------------------
  // pageGet
  // -------------------------------------------------------------------------

  /**
   * Fetches `count` pages via GET /api/v3/page?path=... (markdown render path).
   *
   * Uses the root path when no pages have been created yet so the operation
   * is always meaningful.
   */
  const pageGet = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) {
      const path =
        createdPaths.length > 0 ? createdPaths[i % createdPaths.length] : '/';
      // biome-ignore lint/performance/noAwaitInLoops: intentional serial execution — design mandates 直列発火
      await httpClient.get(`/_api/v3/page?path=${encodeURIComponent(path)}`);
    }
  };

  // -------------------------------------------------------------------------
  // pageList
  // -------------------------------------------------------------------------

  /**
   * Lists pages via GET /api/v3/pages/list?path=/ (page tree walk path).
   */
  const pageList = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: intentional serial execution — design mandates 直列発火
      await httpClient.get('/_api/v3/pages/list?path=%2F');
    }
  };

  // -------------------------------------------------------------------------
  // pageSearch
  // -------------------------------------------------------------------------

  /**
   * Performs full-text search via GET /_api/search?q=<fixed-query>.
   *
   * A fixed query string is used to ensure reproducibility across runs
   * (Req 2.5).  This path exercises the Elasticsearch search path and
   * validates that L2 (OTel auto-instrumentation allow-list) does not
   * break search functionality (Req 7.1).
   */
  const pageSearch = async (count: number): Promise<void> => {
    const encodedQuery = encodeURIComponent(SEARCH_QUERY);
    for (let i = 0; i < count; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: intentional serial execution — design mandates 直列発火
      await httpClient.get(`/_api/search?q=${encodedQuery}&limit=10`);
    }
  };

  // -------------------------------------------------------------------------
  // yjsSessionCleanClose
  // -------------------------------------------------------------------------

  /**
   * Opens a Yjs WebSocket session for each of `count` iterations and closes
   * it cleanly (normal CLOSE handshake).
   *
   * A synthetic page ID is used since the goal is to exercise the server's
   * Yjs connection lifecycle, not to collaborate on real pages.
   */
  const yjsSessionCleanClose = async (count: number): Promise<void> => {
    if (createdIds.length === 0) return; // skip if no pages were created
    for (let i = 0; i < count; i++) {
      const pageId = createdIds[i % createdIds.length];
      const session = createYjsSession(wsBaseUrl, pageId, sessionCookie);
      // biome-ignore lint/performance/noAwaitInLoops: intentional serial execution — design mandates 直列発火
      await session.connect();
      await session.cleanClose();
    }
  };

  // -------------------------------------------------------------------------
  // yjsSessionAbort
  // -------------------------------------------------------------------------

  /**
   * Opens a Yjs WebSocket session for each of `count` iterations and then
   * aborts it immediately (terminate() / TCP RST equivalent).
   *
   * This simulates a NAT half-close or abrupt client disappearance to verify
   * whether the server leaks Y.Doc entries in the `docs` Map (L3).
   */
  const yjsSessionAbort = async (count: number): Promise<void> => {
    if (createdIds.length === 0) return; // skip if no pages were created
    for (let i = 0; i < count; i++) {
      const pageId = createdIds[i % createdIds.length];
      const session = createYjsSession(wsBaseUrl, pageId, sessionCookie);
      // biome-ignore lint/performance/noAwaitInLoops: intentional serial execution — design mandates 直列発火
      await session.connect();
      session.abort();
    }
  };

  return {
    initInstaller,
    pageCreate,
    pageEdit,
    pageGet,
    pageList,
    pageSearch,
    yjsSessionCleanClose,
    yjsSessionAbort,
  };
}

// ---------------------------------------------------------------------------
// Smoke-test entry point
// ---------------------------------------------------------------------------

/**
 * When executed directly with `--smoke`, runs a single cycle of each
 * operation against a local GROWI server (http://localhost:3000) to verify
 * that all endpoints are reachable and return non-error responses.
 *
 * Observable completion condition (Req 2.2, 7.1):
 *   tsx bin/memory-profiler/load-driver.ts --smoke
 */
if (process.argv.includes('--smoke')) {
  const BASE_URL = process.env.GROWI_BASE_URL ?? 'http://localhost:3000';

  (async () => {
    console.log(`[smoke] targeting GROWI at ${BASE_URL}`);
    const driver = createLoadDriver(BASE_URL);

    console.log('[smoke] initInstaller...');
    const { adminEmail } = await driver.initInstaller();
    console.log(`[smoke] admin created: ${adminEmail}`);

    console.log('[smoke] pageCreate x1...');
    await driver.pageCreate(1);
    console.log('[smoke] pageCreate OK');

    console.log('[smoke] pageGet x1...');
    await driver.pageGet(1);
    console.log('[smoke] pageGet OK');

    console.log('[smoke] pageList x1...');
    await driver.pageList(1);
    console.log('[smoke] pageList OK');

    console.log('[smoke] pageSearch x1...');
    await driver.pageSearch(1);
    console.log('[smoke] pageSearch OK');

    console.log('[smoke] yjsSessionCleanClose x1...');
    await driver.yjsSessionCleanClose(1);
    console.log('[smoke] yjsSessionCleanClose OK');

    console.log('[smoke] All smoke checks passed.');
    process.exit(0);
  })().catch((err) => {
    console.error('[smoke] FAILED:', err);
    process.exit(1);
  });
}
