import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import { createUpgradeHandler } from './upgrade-handler';

type AuthenticatedIncomingMessage = IncomingMessage & { user?: IUserHasId };

interface MockSocket {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const { isAccessibleMock } = vi.hoisted(() => ({
  isAccessibleMock: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: {
    model: () => ({ isAccessiblePageByViewer: isAccessibleMock }),
  },
}));

vi.mock('express-session', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('passport', () => ({
  default: {
    initialize: () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
    session: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  },
}));

const sessionConfig = {
  rolling: true,
  secret: 'test-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 86400000 },
  genid: () => 'test-session-id',
};

const createMockRequest = (
  url: string,
  user?: IUserHasId,
): AuthenticatedIncomingMessage => {
  const req = mock<AuthenticatedIncomingMessage>();
  req.url = url;
  req.headers = { cookie: 'connect.sid=test-session' };
  req.user = user;
  return req;
};

const createMockSocket = (): Duplex & MockSocket => {
  return {
    write: vi.fn().mockReturnValue(true),
    destroy: vi.fn(),
  } as unknown as Duplex & MockSocket;
};

describe('UpgradeHandler', () => {
  const handleUpgrade = createUpgradeHandler(sessionConfig);

  it('should authorize a valid user with page access', async () => {
    isAccessibleMock.mockResolvedValue(true);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011', {
      _id: 'user1',
      name: 'Test User',
    } as unknown as IUserHasId);
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
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('should reject with 403 when user has no page access', async () => {
    isAccessibleMock.mockResolvedValue(false);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011', {
      _id: 'user1',
      name: 'Test User',
    } as unknown as IUserHasId);
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(403);
    }
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403'));
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('should reject with 401 when unauthenticated user has no page access', async () => {
    isAccessibleMock.mockResolvedValue(false);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(401);
    }
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('should allow guest user when page allows guest access', async () => {
    isAccessibleMock.mockResolvedValue(true);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.pageId).toBe('507f1f77bcf86cd799439011');
    }
  });
});
