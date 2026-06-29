/**
 * Unit tests for ActivityExtension.
 *
 * Observable contracts under test:
 * 1. normalizeToId (pure helper): object → ID string, string → unchanged,
 *    null/undefined pass through.
 * 2. extension export: is a Prisma.defineExtension result (function).
 * 3. createByParameters: builds the correct Prisma `create` data — mapping
 *    user→userId, target→target (normalized to ID strings), injecting the
 *    Mongoose-compat defaults (v:0, createdAt, snapshot.id, ip/endpoint '').
 *
 * DB-free: a real extended Prisma client is built, but `activities.create` is
 * spied/mocked so no connection is opened. The assertions target the arguments
 * passed to `create`, i.e. the actual data-building contract of the method.
 */
import { PrismaClient } from '~/generated/prisma/client';

import { extension, normalizeToId } from './activity';

describe('normalizeToId (pure helper)', () => {
  it('passes an ID string through unchanged', () => {
    expect(normalizeToId('507f1f77bcf86cd799439011')).toBe(
      '507f1f77bcf86cd799439011',
    );
  });

  it('extracts _id from an object with a string _id', () => {
    expect(
      normalizeToId({ _id: '507f1f77bcf86cd799439011', username: 'alice' }),
    ).toBe('507f1f77bcf86cd799439011');
  });

  it('calls toString() on a non-string _id (ObjectId-like)', () => {
    const objectId = { toString: () => '507f1f77bcf86cd799439011' };
    const userObj = { _id: objectId, username: 'alice' };
    expect(normalizeToId(userObj)).toBe('507f1f77bcf86cd799439011');
  });

  it('falls back to .id when ._id is absent', () => {
    expect(
      normalizeToId({ id: '507f1f77bcf86cd799439022', username: 'bob' }),
    ).toBe('507f1f77bcf86cd799439022');
  });

  it('returns undefined when value is undefined', () => {
    expect(normalizeToId(undefined)).toBeUndefined();
  });

  it('returns null when value is null', () => {
    expect(normalizeToId(null)).toBeNull();
  });
});

describe('extension export', () => {
  it('is a function (Prisma.defineExtension result)', () => {
    expect(extension).toBeDefined();
    expect(typeof extension).toBe('function');
  });
});

describe('ActivityExtension.createByParameters - data-building contract', () => {
  /**
   * Build a real extended client and spy on the underlying `activities.create`
   * so the call is intercepted before any DB I/O. createByParameters obtains
   * its context via Prisma.getExtensionContext(this), which resolves to this
   * same (spied) delegate, so the spy captures exactly what the method builds.
   */
  const buildClient = () => {
    const base = new PrismaClient({
      datasourceUrl: 'mongodb://localhost:27017/test',
    });
    const client = base.$extends(extension);
    // A full, valid activities row to return from the mocked create.
    const returnedRow = {
      _id: 'created-id',
      __v: 0,
      id: 'created-id',
      v: 0,
      action: 'PAGE_VIEW',
      createdAt: new Date(),
      endpoint: '',
      event: null,
      eventModel: null,
      ip: '',
      target: null,
      targetModel: null,
      userId: null,
      snapshot: { id: 'snap-id', username: '' },
    };
    const createSpy = vi
      .spyOn(client.activities, 'create')
      .mockResolvedValue(returnedRow);
    return { client, createSpy };
  };

  it('maps an object user/target to ID strings and injects Mongoose-compat defaults', async () => {
    // Arrange
    const { client, createSpy } = buildClient();
    const userObj = { _id: '507f1f77bcf86cd799439011', username: 'alice' };
    const pageObj = { _id: '507f1f77bcf86cd799439033', path: '/test' };

    // Act
    await client.activities.createByParameters({
      user: userObj,
      target: pageObj,
      targetModel: 'Page',
      action: 'PAGE_VIEW',
      snapshot: { username: 'alice' },
    });

    // Assert: create received normalized string IDs + defaults
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: '507f1f77bcf86cd799439011',
        target: '507f1f77bcf86cd799439033',
        targetModel: 'Page',
        action: 'PAGE_VIEW',
        v: 0,
        ip: '',
        endpoint: '',
      }),
    });

    // snapshot.id is a non-empty generated string; createdAt is a Date
    const data = createSpy.mock.calls[0]?.[0]?.data;
    expect(data).toBeDefined();
    const callData = data as {
      snapshot: { id: string; username: string };
      createdAt: Date;
    };
    expect(typeof callData.snapshot.id).toBe('string');
    expect(callData.snapshot.id.length).toBeGreaterThan(0);
    expect(callData.snapshot.username).toBe('alice');
    expect(callData.createdAt).toBeInstanceOf(Date);
  });

  it('passes ID strings through to create unchanged (the common caller path)', async () => {
    // Arrange: add-activity.ts passes req.user?._id (a bare ID), no target
    const { client, createSpy } = buildClient();

    // Act
    await client.activities.createByParameters({
      ip: '127.0.0.1',
      endpoint: '/_api/v3/pages',
      action: 'PAGE_CREATE',
      user: '507f1f77bcf86cd799439011',
      snapshot: { username: 'bob' },
    });

    // Assert: string ID passes through; explicit ip/endpoint preserved
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: '507f1f77bcf86cd799439011',
        ip: '127.0.0.1',
        endpoint: '/_api/v3/pages',
        action: 'PAGE_CREATE',
        v: 0,
      }),
    });
  });

  it('omits userId/target when user/target are absent', async () => {
    // Arrange: some callers (e.g. system actions) pass no user/target
    const { client, createSpy } = buildClient();

    // Act
    await client.activities.createByParameters({
      ip: '127.0.0.1',
      endpoint: '/_api/v3/admin',
      action: 'ADMIN_APP_SETTING_UPDATE',
      snapshot: {},
    });

    // Assert: userId and target are undefined (not objects, not null-bearing)
    const data = createSpy.mock.calls[0]?.[0]?.data as {
      userId?: string;
      target?: string;
    };
    expect(data.userId).toBeUndefined();
    expect(data.target).toBeUndefined();
  });
});
