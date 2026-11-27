/**
 * Contract of inappnotifications.upsertByActivity: notifications for the same
 * user/target/action/snapshot inside the dedup window are merged into one
 * document holding every activity id; outside the window a new one is created.
 */
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageLoader } from '~/server/models/in-app-notification';
import { prisma } from '~/utils/prisma';

describe('inappnotifications.upsertByActivity', () => {
  const userId = new ObjectId().toString();
  const target = new ObjectId().toString();
  const now = new Date();

  const upsert = (activityId: string, createdAt: Date) =>
    prisma.inappnotifications.upsertByActivity({
      userIds: [userId],
      activityId,
      targetModel: 'Page',
      target,
      action: 'PAGE_CREATE',
      snapshot: '{"path":"/p"}',
      createdAt,
      lastWeek: new Date(createdAt.getTime() - 7 * 24 * 60 * 60 * 1000),
    });

  afterEach(async () => {
    await prisma.inappnotifications.deleteMany({ where: { userId } });
  });

  it('merges activities into one document within the dedup window', async () => {
    const activityA = new ObjectId().toString();
    const activityB = new ObjectId().toString();

    await upsert(activityA, now);
    await upsert(activityB, new Date(now.getTime() + 1000));
    await upsert(activityB, new Date(now.getTime() + 2000));

    const docs = await prisma.inappnotifications.findMany({
      where: { userId },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].activities).toEqual([activityA, activityB]);
    expect(docs[0].status).toBe('UNOPENED');
    expect(docs[0].v).toBe(0);
  });

  it('stores a notification without a snapshot and keeps it readable by Prisma', async () => {
    await prisma.inappnotifications.upsertByActivity({
      userIds: [userId, userId],
      activityId: new ObjectId().toString(),
      targetModel: 'User',
      target,
      action: 'USER_REGISTRATION_APPROVAL_REQUEST',
      snapshot: null,
      createdAt: now,
      lastWeek: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    });

    const docs = await prisma.inappnotifications.findMany({
      where: { userId },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].snapshot).toBeNull();
  });

  it('does not merge a notification without a snapshot into one that has a snapshot', async () => {
    await upsert(new ObjectId().toString(), now);
    await prisma.inappnotifications.upsertByActivity({
      userIds: [userId],
      activityId: new ObjectId().toString(),
      targetModel: 'Page',
      target,
      action: 'PAGE_CREATE',
      snapshot: null,
      createdAt: now,
      lastWeek: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    });

    expect(await prisma.inappnotifications.count({ where: { userId } })).toBe(
      2,
    );
  });

  it('creates one notification per recipient when recipients span several batches', async () => {
    const batchTarget = new ObjectId().toString();
    const userIds = Array.from({ length: 2500 }, () =>
      new ObjectId().toString(),
    );

    try {
      await prisma.inappnotifications.upsertByActivity({
        userIds,
        activityId: new ObjectId().toString(),
        targetModel: 'Page',
        target: batchTarget,
        action: 'PAGE_CREATE',
        snapshot: null,
        createdAt: now,
        lastWeek: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      });

      expect(
        await prisma.inappnotifications.count({
          where: { target: batchTarget },
        }),
      ).toBe(2500);
    } finally {
      await prisma.inappnotifications.deleteMany({
        where: { target: batchTarget },
      });
    }
  });

  it('creates a new document when the previous one is older than the window', async () => {
    await upsert(
      new ObjectId().toString(),
      new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
    );
    await upsert(new ObjectId().toString(), now);

    expect(await prisma.inappnotifications.count({ where: { userId } })).toBe(
      2,
    );
  });
});

describe('inappnotifications.paginateAndIncludeTarget', () => {
  const loadPagesFromDb: PageLoader = (ids) =>
    mongoose
      .model('Page')
      .find({ _id: { $in: ids } })
      .lean<Array<{ _id: { toString(): string } }>>()
      .exec();

  const suffix = new ObjectId().toString();
  let ownerId: string;
  let targetUserId: string;

  beforeAll(async () => {
    // registers the Mongoose Page model read by loadPagesFromDb
    await getInstance();
    const owner = await prisma.users.create({
      data: {
        username: `owner-${suffix}`,
        email: `owner-${suffix}@example.com`,
      },
    });
    const targetUser = await prisma.users.create({
      data: {
        username: `target-${suffix}`,
        email: `target-${suffix}@example.com`,
      },
    });
    ownerId = owner.id;
    targetUserId = targetUser.id;
  });

  it('attaches the user and resolves the target by targetModel, with the total count', async () => {
    await prisma.inappnotifications.create({
      data: {
        userId: ownerId,
        action: 'USER_REGISTRATION_APPROVAL_REQUEST',
        targetModel: 'User',
        target: targetUserId,
        activities: [],
      },
    });

    const result = await prisma.inappnotifications.paginateAndIncludeTarget(
      {
        where: { userId: ownerId },
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        limit: 10,
        offset: 0,
      },
      loadPagesFromDb,
    );

    expect(result.totalDocs).toBe(1);
    expect(result.docs[0].user).toMatchObject({ username: `owner-${suffix}` });
    expect(result.docs[0].target).toMatchObject({
      username: `target-${suffix}`,
    });
    expect(result.docs[0].target).not.toHaveProperty('password');
    expect(result.docs[0].status).toBe('UNOPENED');
  });

  it('resolves a bulk-export job target with its attachment and the activity users', async () => {
    const attachment = await prisma.attachments.create({
      data: {
        fileFormat: 'application/zip',
        fileName: `export-${suffix}.zip`,
        originalName: 'export.zip',
        attachmentType: 'BULK_EXPORT',
        fileSize: 1,
      },
    });
    const job = await prisma.pagebulkexportjobs.create({
      data: {
        userId: ownerId,
        pageId: new ObjectId().toString(),
        format: 'md',
        status: 'completed',
        attachmentId: attachment.id,
      },
    });
    const activity = await prisma.activities.create({
      data: {
        action: 'PAGE_BULK_EXPORT_COMPLETED',
        userId: targetUserId,
        snapshot: { id: targetUserId, username: `target-${suffix}` },
      },
    });
    await prisma.inappnotifications.create({
      data: {
        userId: ownerId,
        action: 'PAGE_BULK_EXPORT_COMPLETED',
        targetModel: 'PageBulkExportJob',
        target: job.id,
        activities: [activity.id],
      },
    });

    const result = await prisma.inappnotifications.paginateAndIncludeTarget(
      {
        where: { userId: ownerId, targetModel: 'PageBulkExportJob' },
        include: { user: true },
      },
      loadPagesFromDb,
    );

    expect(result.docs[0].activities[0].user).toMatchObject({
      username: `target-${suffix}`,
    });
    expect(result.docs[0].target).toMatchObject({
      user: ownerId,
      attachment: { id: attachment.id, originalName: 'export.zip' },
    });
    expect(result.docs[0]).not.toHaveProperty('userId');

    await prisma.inappnotifications.deleteMany({
      where: { userId: ownerId, targetModel: 'PageBulkExportJob' },
    });
  });

  it('reduces a change proposal target to its id without loading it', async () => {
    const proposalId = new ObjectId().toString();
    await prisma.inappnotifications.create({
      data: {
        userId: ownerId,
        action: 'CHANGE_PROPOSAL_APPLY',
        targetModel: 'ChangeProposal',
        target: proposalId,
        activities: [],
      },
    });

    const result = await prisma.inappnotifications.paginateAndIncludeTarget(
      {
        where: { userId: ownerId, targetModel: 'ChangeProposal' },
        limit: 10,
        offset: 0,
      },
      loadPagesFromDb,
    );

    expect(result.docs[0].target).toEqual({ _id: proposalId });
  });

  it('resolves a target that no longer exists to null', async () => {
    await prisma.inappnotifications.create({
      data: {
        userId: ownerId,
        action: 'PAGE_BULK_EXPORT_COMPLETED',
        targetModel: 'PageBulkExportJob',
        target: new ObjectId().toString(),
        activities: [],
      },
    });

    const result = await prisma.inappnotifications.paginateAndIncludeTarget(
      {
        where: { userId: ownerId, targetModel: 'PageBulkExportJob' },
        include: { user: true },
      },
      loadPagesFromDb,
    );

    expect(result.docs[0].target).toBeNull();
    expect(result.docs[0].activities).toEqual([]);
  });

  it('resolves a Page target through the supplied page loader', async () => {
    const pageId = new ObjectId();
    await mongoose.connection
      .collection('pages')
      .insertOne({ _id: pageId, path: `/in-app-notification/${suffix}` });
    await prisma.inappnotifications.create({
      data: {
        userId: ownerId,
        action: 'PAGE_UPDATE',
        targetModel: 'Page',
        target: pageId.toString(),
        activities: [],
      },
    });

    const result = await prisma.inappnotifications.paginateAndIncludeTarget(
      {
        where: { userId: ownerId, targetModel: 'Page' },
        limit: 10,
        offset: 0,
      },
      loadPagesFromDb,
    );

    expect(result.docs[0].target).toMatchObject({
      path: `/in-app-notification/${suffix}`,
    });
  });
});
