/**
 * Unit tests for LoadDriver
 *
 * Verifies that createLoadDriver returns an object with all required interface
 * methods, and that each method calls the underlying HTTP / Yjs clients with
 * the expected patterns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock lib/http-client
// ---------------------------------------------------------------------------

const mockGet = vi
  .fn()
  .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
const mockPost = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ page: { _id: 'page-id-001' } }),
});

vi.mock('./lib/http-client', () => ({
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: mockPost,
  })),
}));

// ---------------------------------------------------------------------------
// Mock lib/installer-driver
// ---------------------------------------------------------------------------

const mockInitInstaller = vi.fn().mockResolvedValue({
  adminEmail: 'admin@example.com',
  adminPassword: 'password123',
  cookie: 'connect.sid=abc123',
});

vi.mock('./lib/installer-driver', () => ({
  createInstallerDriver: vi.fn(() => ({
    initInstaller: mockInitInstaller,
  })),
}));

// ---------------------------------------------------------------------------
// Mock lib/yjs-client
// ---------------------------------------------------------------------------

const mockYjsConnect = vi.fn().mockResolvedValue(undefined);
const mockYjsCleanClose = vi.fn().mockResolvedValue(undefined);
const mockYjsAbort = vi.fn();

vi.mock('./lib/yjs-client', () => ({
  createYjsSession: vi.fn(() => ({
    connect: mockYjsConnect,
    cleanClose: mockYjsCleanClose,
    abort: mockYjsAbort,
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLoadDriver', () => {
  let createLoadDriver: (baseUrl: string) => unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('./load-driver');
    createLoadDriver = module.createLoadDriver;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns an object with all 8 required interface methods', () => {
    const driver = createLoadDriver('http://localhost:3000') as Record<
      string,
      unknown
    >;

    expect(typeof driver.initInstaller).toBe('function');
    expect(typeof driver.pageCreate).toBe('function');
    expect(typeof driver.pageEdit).toBe('function');
    expect(typeof driver.pageGet).toBe('function');
    expect(typeof driver.pageList).toBe('function');
    expect(typeof driver.pageSearch).toBe('function');
    expect(typeof driver.yjsSessionCleanClose).toBe('function');
    expect(typeof driver.yjsSessionAbort).toBe('function');
  });

  describe('initInstaller', () => {
    it('delegates to the installer driver and returns credentials', async () => {
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
      };

      const result = await driver.initInstaller();

      expect(mockInitInstaller).toHaveBeenCalledOnce();
      expect(result).toEqual({
        adminEmail: 'admin@example.com',
        adminPassword: 'password123',
        cookie: 'connect.sid=abc123',
      });
    });
  });

  describe('pageCreate', () => {
    it('calls POST /api/v3/page for each count', async () => {
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
        pageCreate(count: number): Promise<void>;
      };
      await driver.initInstaller();
      vi.clearAllMocks();

      await driver.pageCreate(3);

      expect(mockPost).toHaveBeenCalledTimes(3);
      const [path] = mockPost.mock.calls[0] as [string, ...unknown[]];
      expect(path).toMatch(/\/_api\/v3\/page/);
    });
  });

  describe('pageEdit', () => {
    it('calls POST for each edit operation', async () => {
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
        pageEdit(count: number): Promise<void>;
      };
      await driver.initInstaller();
      vi.clearAllMocks();

      await driver.pageEdit(2);

      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('pageGet', () => {
    it('calls GET /api/v3/page for each count', async () => {
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
        pageGet(count: number): Promise<void>;
      };
      await driver.initInstaller();
      vi.clearAllMocks();

      await driver.pageGet(2);

      expect(mockGet).toHaveBeenCalledTimes(2);
      const [path] = mockGet.mock.calls[0] as [string, ...unknown[]];
      expect(path).toMatch(/\/_api\/v3\/page/);
    });
  });

  describe('pageList', () => {
    it('calls GET /api/v3/pages/list for each count', async () => {
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
        pageList(count: number): Promise<void>;
      };
      await driver.initInstaller();
      vi.clearAllMocks();

      await driver.pageList(2);

      expect(mockGet).toHaveBeenCalledTimes(2);
      const [path] = mockGet.mock.calls[0] as [string, ...unknown[]];
      expect(path).toMatch(/\/_api\/v3\/pages/);
    });
  });

  describe('pageSearch', () => {
    it('calls GET /_api/search for each count with a fixed query pattern', async () => {
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
        pageSearch(count: number): Promise<void>;
      };
      await driver.initInstaller();
      vi.clearAllMocks();

      await driver.pageSearch(2);

      expect(mockGet).toHaveBeenCalledTimes(2);
      const [path] = mockGet.mock.calls[0] as [string, ...unknown[]];
      expect(path).toMatch(/\/_api\/search\?q=/);
    });
  });

  describe('yjsSessionCleanClose', () => {
    it('creates a Yjs session and calls cleanClose for each count', async () => {
      const { createYjsSession } = await import('./lib/yjs-client');
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
        pageCreate(count: number): Promise<void>;
        yjsSessionCleanClose(count: number): Promise<void>;
      };
      await driver.initInstaller();
      await driver.pageCreate(2); // populate createdIds so Yjs tests don't early-return
      vi.clearAllMocks();

      await driver.yjsSessionCleanClose(2);

      expect(createYjsSession).toHaveBeenCalledTimes(2);
      expect(mockYjsConnect).toHaveBeenCalledTimes(2);
      expect(mockYjsCleanClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('yjsSessionAbort', () => {
    it('creates a Yjs session, connects, and then aborts for each count', async () => {
      const { createYjsSession } = await import('./lib/yjs-client');
      const driver = createLoadDriver('http://localhost:3000') as {
        initInstaller(): Promise<{
          adminEmail: string;
          adminPassword: string;
          cookie: string;
        }>;
        pageCreate(count: number): Promise<void>;
        yjsSessionAbort(count: number): Promise<void>;
      };
      await driver.initInstaller();
      await driver.pageCreate(2); // populate createdIds so Yjs tests don't early-return
      vi.clearAllMocks();

      await driver.yjsSessionAbort(2);

      expect(createYjsSession).toHaveBeenCalledTimes(2);
      expect(mockYjsConnect).toHaveBeenCalledTimes(2);
      expect(mockYjsAbort).toHaveBeenCalledTimes(2);
    });
  });
});
