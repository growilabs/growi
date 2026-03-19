import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { mock } from 'vitest-mock-extended';

import { createUpgradeHandler } from './upgrade-handler';

vi.mock('mongoose', () => {
  const isAccessiblePageByViewer = vi.fn();
  return {
    default: {
      model: () => ({ isAccessiblePageByViewer }),
    },
    __mockIsAccessible: isAccessiblePageByViewer,
  };
});

vi.mock('express-session', () => ({
  default: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('passport', () => ({
  default: {
    initialize: () => (_req: any, _res: any, next: () => void) => next(),
    session: () => (_req: any, _res: any, next: () => void) => next(),
  },
}));

const getIsAccessibleMock = async () => {
  const mod = await import('mongoose');
  return (mod as any).__mockIsAccessible as ReturnType<typeof vi.fn>;
};

const sessionConfig = {
  rolling: true,
  secret: 'test-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 86400000 },
  genid: () => 'test-session-id',
};

const createMockRequest = (url: string): IncomingMessage => {
  const req = mock<IncomingMessage>();
  req.url = url;
  req.headers = { cookie: 'connect.sid=test-session' };
  return req;
};

const createMockSocket = (): Duplex => {
  const socket = mock<Duplex>();
  socket.write = vi.fn().mockReturnValue(true);
  socket.destroy = vi.fn();
  return socket;
};

describe('UpgradeHandler', () => {
  const handleUpgrade = createUpgradeHandler(sessionConfig);

  it('should authorize a valid user with page access', async () => {
    const isAccessible = await getIsAccessibleMock();
    isAccessible.mockResolvedValue(true);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    (request as any).user = { _id: 'user1', name: 'Test User' };

    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.pageId).toBe('507f1f77bcf86cd799439011');
    }
  });

  it('should reject with 400 for missing/malformed URL path', async () => {
    const request = createMockRequest('/invalid/path');
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(400);
    }
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('400'));
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('should reject with 403 when user has no page access', async () => {
    const isAccessible = await getIsAccessibleMock();
    isAccessible.mockResolvedValue(false);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    (request as any).user = { _id: 'user1', name: 'Test User' };

    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(403);
    }
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403'));
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('should reject with 401 when unauthenticated user has no page access', async () => {
    const isAccessible = await getIsAccessibleMock();
    isAccessible.mockResolvedValue(false);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    (request as any).user = undefined; // explicitly unauthenticated

    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(401);
    }
  });

  it('should allow guest user when page allows guest access', async () => {
    const isAccessible = await getIsAccessibleMock();
    isAccessible.mockResolvedValue(true);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    (request as any).user = undefined; // guest user

    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.pageId).toBe('507f1f77bcf86cd799439011');
    }
  });
});
