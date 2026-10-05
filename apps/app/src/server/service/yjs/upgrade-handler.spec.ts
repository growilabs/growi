import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type Crowi from '../../crowi';
import { UserStatus } from '../../models/user/conts';
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

const { sessionMiddlewareMock } = vi.hoisted(() => ({
  sessionMiddlewareMock: vi.fn(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock('express-session', () => ({
  default: () => sessionMiddlewareMock,
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
  // A real IncomingMessage: a deep mock would answer truthy for properties the
  // auth middlewares probe (e.g. isBrandLogo) and hide guest rejections.
  const req: AuthenticatedIncomingMessage = new IncomingMessage(new Socket());
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

const createUser = (overrides: Partial<IUserHasId> = {}): IUserHasId =>
  ({
    _id: 'user1',
    name: 'Test User',
    status: UserStatus.STATUS_ACTIVE,
    readOnly: false,
    ...overrides,
  }) as unknown as IUserHasId;

describe('UpgradeHandler', () => {
  const handleUpgrade = createUpgradeHandler(sessionConfig, mock<Crowi>());

  it('should authorize a valid user with page access', async () => {
    isAccessibleMock.mockResolvedValue(true);

    const request = createMockRequest(
      '/yjs/507f1f77bcf86cd799439011',
      createUser(),
    );
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

    const request = createMockRequest(
      '/yjs/507f1f77bcf86cd799439011',
      createUser(),
    );
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
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401'));
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('should reject guest with 401 even when the page is viewable by guests', async () => {
    isAccessibleMock.mockResolvedValue(true);

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(401);
    }
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401'));
  });

  it('should reject read-only user with 403 even when the page is viewable', async () => {
    isAccessibleMock.mockResolvedValue(true);

    const request = createMockRequest(
      '/yjs/507f1f77bcf86cd799439011',
      createUser({ readOnly: true }),
    );
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(403);
    }
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it.each([
    ['registered', UserStatus.STATUS_REGISTERED],
    ['suspended', UserStatus.STATUS_SUSPENDED],
    ['invited', UserStatus.STATUS_INVITED],
    ['deleted', UserStatus.STATUS_DELETED],
  ])('should reject %s (non-active) user with 403 even when the page is viewable', async (_label, status) => {
    isAccessibleMock.mockResolvedValue(true);

    const request = createMockRequest(
      '/yjs/507f1f77bcf86cd799439011',
      createUser({ status }),
    );
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(403);
    }
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it('should reject with 401 when session middleware fails', async () => {
    sessionMiddlewareMock.mockImplementationOnce(
      (_req: unknown, _res: unknown, next: (err?: unknown) => void) =>
        next(new Error('session store unavailable')),
    );

    const request = createMockRequest('/yjs/507f1f77bcf86cd799439011');
    const socket = createMockSocket();
    const head = Buffer.alloc(0);

    const result = await handleUpgrade(request, socket, head);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.statusCode).toBe(401);
    }
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401'));
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});
