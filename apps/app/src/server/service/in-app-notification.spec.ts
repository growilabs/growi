import type { IPageHasId } from '@growi/core';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';

import type Crowi from '../crowi';
import { InAppNotificationService } from './in-app-notification';

const { STATUS_UNOPENED } = InAppNotificationStatuses;

// Mock dependencies
vi.mock('~/server/models/in-app-notification-settings', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('~/server/models/subscription', () => ({
  default: {
    getSubscription: vi.fn().mockResolvedValue([]),
    subscribeByPageId: vi.fn(),
  },
}));

vi.mock('./in-app-notification/in-app-notification-utils', () => ({
  generateSnapshot: vi.fn().mockResolvedValue('{"path":"/test-page"}'),
}));

const { mockCreateMany } = vi.hoisted(() => ({
  mockCreateMany: vi.fn(),
}));

vi.mock('~/utils/prisma', () => ({
  prisma: { inappnotifications: { createMany: mockCreateMany } },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('./socket-io/helper', () => ({
  getRoomNameWithId: vi.fn().mockReturnValue('room-id'),
  RoomPrefix: { USER: 'user' },
}));

const buildMockCrowi = (socketInitialized = false) => ({
  events: {
    activity: { on: vi.fn(), emit: vi.fn() },
  },
  socketIoService: {
    isInitialized: socketInitialized,
    getDefaultSocket: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({ emit: vi.fn() }),
    }),
  },
});

describe('InAppNotificationService.insertMentionNotifications', () => {
  let service: InAppNotificationService;
  const mockInsertMany = mockCreateMany;

  const userId1 = new Types.ObjectId();
  const userId2 = new Types.ObjectId();
  const actionUserId = new Types.ObjectId();
  const activityId = new Types.ObjectId();
  const pageId = new Types.ObjectId();

  const mockPage = { _id: pageId, path: '/test-page' } as unknown as IPageHasId;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InAppNotificationService(
      buildMockCrowi() as unknown as Crowi,
    );
  });

  it('filters out actionUserId from mentionedUserIds', async () => {
    const mentionedUserIds = [userId1, actionUserId, userId2];

    await service.insertMentionNotifications(
      mentionedUserIds,
      actionUserId,
      activityId,
      mockPage,
    );

    expect(mockInsertMany).toHaveBeenCalledOnce();
    const { data } = mockInsertMany.mock.calls[0][0] as {
      data: Array<{ userId: string }>;
    };
    const userIds = data.map((d) => d.userId);

    expect(userIds).toContain(userId1.toString());
    expect(userIds).toContain(userId2.toString());
    expect(userIds).not.toContain(actionUserId.toString());
  });

  it('returns early and does not insert when mentionedUserIds is empty', async () => {
    await service.insertMentionNotifications(
      [],
      actionUserId,
      activityId,
      mockPage,
    );

    expect(mockInsertMany).not.toHaveBeenCalled();
  });

  it('returns early and does not insert when all mentions are self-mentions', async () => {
    await service.insertMentionNotifications(
      [actionUserId],
      actionUserId,
      activityId,
      mockPage,
    );

    expect(mockInsertMany).not.toHaveBeenCalled();
  });

  it('inserts notifications with correct fields', async () => {
    await service.insertMentionNotifications(
      [userId1],
      actionUserId,
      activityId,
      mockPage,
    );

    expect(mockInsertMany).toHaveBeenCalledOnce();
    const { data } = mockInsertMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    const doc = data[0];

    expect(doc).toMatchObject({
      userId: userId1.toString(),
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: pageId.toString(),
      action: SupportedAction.ACTION_COMMENT_MENTION,
      status: STATUS_UNOPENED,
      activities: [activityId.toString()],
    });
    expect(doc.snapshot).toBe('{"path":"/test-page"}');
  });

  it('emits socket event to each notified user', async () => {
    const mockSocket = { in: vi.fn().mockReturnValue({ emit: vi.fn() }) };
    const crowi = buildMockCrowi(true);
    crowi.socketIoService.getDefaultSocket.mockReturnValue(
      mockSocket as unknown as ReturnType<
        typeof crowi.socketIoService.getDefaultSocket
      >,
    );
    service = new InAppNotificationService(crowi as unknown as Crowi);

    await service.insertMentionNotifications(
      [userId1, userId2],
      actionUserId,
      activityId,
      mockPage,
    );

    expect(mockSocket.in).toHaveBeenCalledTimes(2);
  });

  it('does not emit socket event when socketIoService is not initialized', async () => {
    const crowi = buildMockCrowi(false);
    service = new InAppNotificationService(crowi as unknown as Crowi);

    await service.insertMentionNotifications(
      [userId1],
      actionUserId,
      activityId,
      mockPage,
    );

    expect(crowi.socketIoService.getDefaultSocket).not.toHaveBeenCalled();
  });
});
