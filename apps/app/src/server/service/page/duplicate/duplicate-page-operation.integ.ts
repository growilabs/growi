import { PageGrant } from '@growi/core';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';

import {
  createDuplicatePageOperation,
  deleteDuplicatePageOperation,
  LEGACY_RECORD_MIN_AGE_MS,
  type OwnedDuplicatePageOperation,
  OwnershipLostError,
  recordProgress,
  STALL_THRESHOLD_MS,
  takeOverStalledDuplicate,
} from './duplicate-page-operation';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

const later = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

describe('duplicate PageOperation ownership and progress', () => {
  let sourcePage: PageDocument;
  // Holds the hydrated user document; only _id is read by the tests.
  let user: { readonly _id: Types.ObjectId };
  let userId: string;

  const create = (): Promise<OwnedDuplicatePageOperation> =>
    createDuplicatePageOperation({
      page: sourcePage,
      userId,
      fromPath: '/dup-page-op/source',
      toPath: '/dup-page-op/copy',
    });

  const exists = async (operationId: string): Promise<boolean> =>
    (await PageOperation.exists({ _id: operationId })) != null;

  beforeAll(async () => {
    await getInstance();
    user = await mongoose.model('User').create({
      name: 'dupPageOpUser',
      username: 'dupPageOpUser',
      email: 'dupPageOpUser@example.com',
    });
    userId = user._id.toString();
    const Page = mongoose.model<PageDocument, PageModel>('Page');
    sourcePage = await Page.create({
      path: '/dup-page-op/source',
      grant: PageGrant.GRANT_USER_GROUP,
      descendantCount: 7,
    });
  });

  // takeOverStalledDuplicate looks at every duplicate PageOperation, so leftovers
  // from other files in this worker's database must not be visible to it.
  beforeEach(async () => {
    await PageOperation.deleteMany({ actionType: PageActionType.Duplicate });
  });

  afterAll(async () => {
    await PageOperation.deleteMany({ actionType: PageActionType.Duplicate });
    await mongoose.model('Page').deleteOne({ _id: sourcePage._id });
    await mongoose.model('User').deleteOne({ _id: user._id });
  });

  it('keeps the operation while its owner reports progress and deletes it on the owner request', async () => {
    const operation = await create();

    await recordProgress(operation)();
    expect(await exists(operation.operationId)).toBe(true);

    await deleteDuplicatePageOperation(operation);
    expect(await exists(operation.operationId)).toBe(false);
  });

  it('takes over only an operation that has not progressed for STALL_THRESHOLD_MS', async () => {
    const createdAt = new Date();
    const operation = await create();

    expect(
      await takeOverStalledDuplicate(
        later(createdAt, STALL_THRESHOLD_MS - 10 * SECOND_MS),
      ),
    ).toBeNull();

    const stalled = await takeOverStalledDuplicate(
      later(createdAt, STALL_THRESHOLD_MS + 10 * SECOND_MS),
    );

    expect(stalled).toEqual({
      operation: {
        operationId: operation.operationId,
        ownerToken: expect.any(String),
      },
      fromPath: '/dup-page-op/source',
      toPath: '/dup-page-op/copy',
      userId,
      sourceGrant: PageGrant.GRANT_USER_GROUP,
      sourceDescendantCount: 7,
      sourceIsEmpty: false,
    });
    expect(stalled?.operation.ownerToken).not.toBe(operation.ownerToken);
  });

  it('no longer treats an operation as stalled once its owner reports progress', async () => {
    const operation = await create();
    // Arrange: the last progress was long ago, so the operation looks stalled.
    await PageOperation.updateOne(
      { _id: operation.operationId },
      { $set: { lastProgressAt: later(new Date(), -5 * MINUTE_MS) } },
    );

    await recordProgress(operation)();

    expect(await takeOverStalledDuplicate(new Date())).toBeNull();
  });

  it('reports an empty source top page as empty', async () => {
    const createdAt = new Date();
    const emptySource = await mongoose
      .model<PageDocument, PageModel>('Page')
      .create({
        path: '/dup-page-op/empty-source',
        grant: PageGrant.GRANT_PUBLIC,
        descendantCount: 2,
        isEmpty: true,
      });
    try {
      await createDuplicatePageOperation({
        page: emptySource,
        userId,
        fromPath: '/dup-page-op/empty-source',
        toPath: '/dup-page-op/empty-copy',
      });

      const stalled = await takeOverStalledDuplicate(
        later(createdAt, STALL_THRESHOLD_MS + 10 * SECOND_MS),
      );

      expect(stalled?.sourceIsEmpty).toBe(true);
    } finally {
      await mongoose.model('Page').deleteOne({ _id: emptySource._id });
    }
  });

  it('lets only one of two simultaneous take-overs succeed', async () => {
    const createdAt = new Date();
    await create();
    const now = later(createdAt, STALL_THRESHOLD_MS + 10 * SECOND_MS);

    const results = await Promise.all([
      takeOverStalledDuplicate(now),
      takeOverStalledDuplicate(now),
    ]);

    expect(results.filter((r) => r != null)).toHaveLength(1);
  });

  it('rejects progress and deletion from the previous owner after a take-over, while the new owner keeps both', async () => {
    const createdAt = new Date();
    const previous = await create();
    const stalled = await takeOverStalledDuplicate(
      later(createdAt, STALL_THRESHOLD_MS + 10 * SECOND_MS),
    );
    if (stalled == null) {
      throw new Error('expected the operation to be taken over');
    }

    await expect(recordProgress(previous)()).rejects.toBeInstanceOf(
      OwnershipLostError,
    );
    await expect(deleteDuplicatePageOperation(previous)).rejects.toBeInstanceOf(
      OwnershipLostError,
    );
    expect(await exists(previous.operationId)).toBe(true);

    await recordProgress(stalled.operation)();
    await deleteDuplicatePageOperation(stalled.operation);
    expect(await exists(previous.operationId)).toBe(false);
  });

  it('takes over a PageOperation from a previous version only once it is LEGACY_RECORD_MIN_AGE_MS old', async () => {
    const createdAt = new Date();
    // Written the way PageService.duplicate did before ownerToken /
    // lastProgressAt existed: a spread copy of the hydrated page and the user document.
    const legacy = await PageOperation.create({
      actionType: PageActionType.Duplicate,
      actionStage: PageActionStage.Main,
      page: { ...sourcePage },
      user,
      fromPath: '/dup-page-op/source',
      toPath: '/dup-page-op/copy',
    });

    expect(
      await takeOverStalledDuplicate(
        later(createdAt, LEGACY_RECORD_MIN_AGE_MS - MINUTE_MS),
      ),
    ).toBeNull();

    const stalled = await takeOverStalledDuplicate(
      later(createdAt, LEGACY_RECORD_MIN_AGE_MS + MINUTE_MS),
    );
    expect(stalled).toEqual({
      operation: {
        operationId: legacy._id.toString(),
        ownerToken: expect.any(String),
      },
      fromPath: '/dup-page-op/source',
      toPath: '/dup-page-op/copy',
      userId,
      sourceGrant: PageGrant.GRANT_USER_GROUP,
      sourceDescendantCount: 7,
      sourceIsEmpty: false,
    });

    // The taker now owns it like any other operation.
    if (stalled == null) {
      throw new Error('expected the legacy operation to be taken over');
    }
    await deleteDuplicatePageOperation(stalled.operation);
    expect(await exists(legacy._id.toString())).toBe(false);
  });

  // Written straight to the collection: the model would not let these be saved.
  const incompleteRecords = [
    {
      missing: 'toPath',
      fields: {
        page: {
          _id: new mongoose.Types.ObjectId(),
          grant: PageGrant.GRANT_PUBLIC,
          descendantCount: 0,
        },
      },
    },
    {
      missing: 'a valid page.grant',
      fields: {
        page: {
          _id: new mongoose.Types.ObjectId(),
          grant: 99,
          descendantCount: 0,
        },
        toPath: '/dup-page-op/incomplete-copy',
      },
    },
    {
      missing: 'page.descendantCount',
      fields: {
        page: {
          _id: new mongoose.Types.ObjectId(),
          grant: PageGrant.GRANT_PUBLIC,
        },
        toPath: '/dup-page-op/incomplete-copy',
      },
    },
  ];

  it.each(
    incompleteRecords,
  )('deletes an expired operation lacking $missing and returns the next expired one in the same call', async ({
    fields,
  }) => {
    const createdAt = new Date();
    const incompleteId = new mongoose.Types.ObjectId();
    await PageOperation.collection.insertOne({
      _id: incompleteId,
      actionType: PageActionType.Duplicate,
      actionStage: PageActionStage.Main,
      user: { _id: user._id },
      fromPath: '/dup-page-op/incomplete-source',
      ownerToken: 'incomplete-owner',
      lastProgressAt: createdAt,
      ...fields,
    });
    const complete = await create();

    const stalled = await takeOverStalledDuplicate(
      later(createdAt, STALL_THRESHOLD_MS + 10 * SECOND_MS),
    );

    expect(stalled?.operation.operationId).toBe(complete.operationId);
    expect(await exists(incompleteId.toString())).toBe(false);
  });

  it('deletes an incomplete PageOperation from a previous version once it is LEGACY_RECORD_MIN_AGE_MS old', async () => {
    const createdAt = new Date();
    // No ownerToken / lastProgressAt, as before they existed, and no toPath.
    const legacy = await PageOperation.collection.insertOne({
      actionType: PageActionType.Duplicate,
      actionStage: PageActionStage.Main,
      page: {
        _id: sourcePage._id,
        grant: PageGrant.GRANT_PUBLIC,
        descendantCount: 0,
      },
      user: { _id: user._id },
      fromPath: '/dup-page-op/source',
    });

    expect(
      await takeOverStalledDuplicate(
        later(createdAt, LEGACY_RECORD_MIN_AGE_MS + MINUTE_MS),
      ),
    ).toBeNull();
    expect(await exists(legacy.insertedId.toString())).toBe(false);
  });

  it('does not take over PageOperations of other action types', async () => {
    await PageOperation.create({
      actionType: PageActionType.Rename,
      actionStage: PageActionStage.Main,
      page: sourcePage,
      user: { _id: userId },
      fromPath: '/dup-page-op/rename-source',
      toPath: '/dup-page-op/rename-target',
    });

    try {
      expect(
        await takeOverStalledDuplicate(
          later(new Date(), LEGACY_RECORD_MIN_AGE_MS + MINUTE_MS),
        ),
      ).toBeNull();
    } finally {
      await PageOperation.deleteMany({
        fromPath: '/dup-page-op/rename-source',
      });
    }
  });
});
