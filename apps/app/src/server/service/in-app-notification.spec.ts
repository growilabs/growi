import type { IPageHasId } from '@growi/core';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import type { ActivityDocument } from '~/server/models/activity';
import { InAppNotification } from '~/server/models/in-app-notification';

import type Crowi from '../crowi';
import { InAppNotificationService } from './in-app-notification';

const { STATUS_UNOPENED } = InAppNotificationStatuses;

// Mock dependencies
vi.mock('~/server/models/in-app-notification', () => ({
  InAppNotification: {
    insertMany: vi.fn(),
    bulkWrite: vi.fn(),
    countDocuments: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
  },
}));

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
  const mockInsertMany = vi.mocked(InAppNotification.insertMany);

  const userId1 = new Types.ObjectId();
  const userId2 = new Types.ObjectId();
  const actionUserId = new Types.ObjectId();
  const activityId = new Types.ObjectId();
  const pageId = new Types.ObjectId();

  const mockActivity = { _id: activityId } as unknown as ActivityDocument;
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
      mockActivity,
      mockPage,
    );

    expect(mockInsertMany).toHaveBeenCalledOnce();
    const insertedDocs = mockInsertMany.mock.calls[0][0] as unknown[];
    const userIds = insertedDocs.map((d) =>
      (d as { user: Types.ObjectId }).user.toString(),
    );

    expect(userIds).toContain(userId1.toString());
    expect(userIds).toContain(userId2.toString());
    expect(userIds).not.toContain(actionUserId.toString());
  });

  it('returns early and does not insert when mentionedUserIds is empty', async () => {
    await service.insertMentionNotifications(
      [],
      actionUserId,
      mockActivity,
      mockPage,
    );

    expect(mockInsertMany).not.toHaveBeenCalled();
  });

  it('returns early and does not insert when all mentions are self-mentions', async () => {
    await service.insertMentionNotifications(
      [actionUserId],
      actionUserId,
      mockActivity,
      mockPage,
    );

    expect(mockInsertMany).not.toHaveBeenCalled();
  });

  it('inserts notifications with correct fields', async () => {
    await service.insertMentionNotifications(
      [userId1],
      actionUserId,
      mockActivity,
      mockPage,
    );

    expect(mockInsertMany).toHaveBeenCalledOnce();
    const [docs, options] = mockInsertMany.mock.calls[0] as unknown[];
    const doc = (docs as unknown[])[0] as Record<string, unknown>;

    expect(options).toEqual({ ordered: false });
    expect(doc).toMatchObject({
      user: userId1,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: pageId,
      action: SupportedAction.ACTION_COMMENT_MENTION,
      status: STATUS_UNOPENED,
      activities: [activityId],
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
      mockActivity,
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
      mockActivity,
      mockPage,
    );

    expect(crowi.socketIoService.getDefaultSocket).not.toHaveBeenCalled();
  });
});
