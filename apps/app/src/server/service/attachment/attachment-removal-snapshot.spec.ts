import type { IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import {
  type IActivity,
  MODEL_ATTACHMENT,
  SupportedAction,
} from '~/interfaces/activity';

import type ActivityService from '../activity';
import {
  type ActivityActor,
  type ActivityCreator,
  type AttachmentLike,
  buildAttachmentRemoveSnapshot,
  recordCascadeAttachmentRemovals,
} from './attachment-removal-snapshot';

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
  }),
}));

describe('buildAttachmentRemoveSnapshot', () => {
  const attachment: AttachmentLike = {
    _id: '662e5f0e1d3c2a0012345678',
    originalName: 'diagram.png',
    fileSize: 2048,
    pageId: '507f191e810c19729de860ea',
  };

  describe('when every input is available (req 2.1, 2.2, 3.3)', () => {
    it('returns a snapshot holding the four attachment fields and the operator username, and nothing else', () => {
      const snapshot = buildAttachmentRemoveSnapshot(
        attachment,
        '/Sandbox/attachments',
        'alice',
      );

      // toStrictEqual also guards against leaking extra attachment
      // fields (e.g. _id) into the snapshot.
      expect(snapshot).toStrictEqual({
        username: 'alice',
        originalName: 'diagram.png',
        pagePath: '/Sandbox/attachments',
        pageId: '507f191e810c19729de860ea',
        fileSize: 2048,
      });
    });

    it('preserves fileSize 0 instead of treating it as missing', () => {
      const snapshot = buildAttachmentRemoveSnapshot(
        { ...attachment, fileSize: 0 },
        '/Sandbox/attachments',
        'alice',
      );

      expect(snapshot.fileSize).toBe(0);
    });
  });

  describe('when inputs are partially missing (req 2.3)', () => {
    it('leaves pagePath and username unresolved while keeping the fields it could resolve', () => {
      const snapshot = buildAttachmentRemoveSnapshot(
        attachment,
        undefined,
        undefined,
      );

      expect(snapshot.pagePath).toBeUndefined();
      expect(snapshot.username).toBeUndefined();
      expect(snapshot.originalName).toBe('diagram.png');
      expect(snapshot.pageId).toBe('507f191e810c19729de860ea');
      expect(snapshot.fileSize).toBe(2048);
    });

    it('resolves no optional field from a minimal attachment', () => {
      const minimal: AttachmentLike = { _id: '662e5f0e1d3c2a0012345678' };

      const snapshot = buildAttachmentRemoveSnapshot(
        minimal,
        undefined,
        undefined,
      );

      expect(snapshot.username).toBeUndefined();
      expect(snapshot.originalName).toBeUndefined();
      expect(snapshot.pagePath).toBeUndefined();
      expect(snapshot.pageId).toBeUndefined();
      expect(snapshot.fileSize).toBeUndefined();
    });
  });

  describe('page -> pageId caller contract', () => {
    // Mongoose attachment docs hold their page reference as `page`
    // (ObjectId), while the builder reads only the Prisma alias `pageId`.
    const mongooseShapedDoc = {
      _id: '662e5f0e1d3c2a0012345678',
      originalName: 'diagram.png',
      fileSize: 2048,
      page: '507f191e810c19729de860ea',
    };

    it('silently omits pageId when a Mongoose-shaped attachment is passed without mapping page -> pageId', () => {
      // The un-mapped doc still satisfies AttachmentLike structurally
      // (pageId is optional), so the type checker cannot catch the missing
      // mapping — this test pins that the omission is silent.
      const snapshot = buildAttachmentRemoveSnapshot(
        mongooseShapedDoc,
        '/Sandbox/attachments',
        'alice',
      );

      expect(snapshot.pageId).toBeUndefined();
    });

    it('records pageId once the caller maps page -> pageId', () => {
      const { page, ...rest } = mongooseShapedDoc;
      const mapped: AttachmentLike = { ...rest, pageId: page };

      const snapshot = buildAttachmentRemoveSnapshot(
        mapped,
        '/Sandbox/attachments',
        'alice',
      );

      expect(snapshot.pageId).toBe('507f191e810c19729de860ea');
    });
  });

  describe('purity', () => {
    it('returns a new object and never mutates its inputs', () => {
      // Freezing makes any mutation attempt throw (ESM strict mode).
      const frozen: AttachmentLike = Object.freeze({ ...attachment });
      const inputCopy = { ...frozen };

      const snapshot = buildAttachmentRemoveSnapshot(
        frozen,
        '/Sandbox/attachments',
        'alice',
      );

      expect(snapshot).not.toBe(frozen);
      expect(frozen).toStrictEqual(inputCopy);
    });
  });
});

describe('recordCascadeAttachmentRemovals', () => {
  const attachments: AttachmentLike[] = [
    { _id: 'att-1', originalName: 'a.png', fileSize: 100, pageId: 'page-1' },
    { _id: 'att-2', originalName: 'b.pdf', fileSize: 200, pageId: 'page-2' },
    // pageId deliberately absent from pageIdToPath (unresolvable page)
    { _id: 'att-3', originalName: 'c.txt', fileSize: 300, pageId: 'page-x' },
  ];

  const pageIdToPath = new Map<string, string>([
    ['page-1', '/Sandbox'],
    ['page-2', '/Sandbox/child'],
  ]);

  const actorUser = mock<IUserHasId>({ username: 'alice' });
  const actor: ActivityActor = {
    user: actorUser,
    ip: '192.0.2.10',
    endpoint: '/_api/v3/pages/delete-completely',
  };

  const newCreateActivityMock = () =>
    vi
      .fn<ActivityCreator['createActivity']>()
      .mockResolvedValue(mock<IActivity>());

  beforeEach(() => {
    mockLoggerError.mockClear();
  });

  describe('per-attachment creation (req 3.1, 3.2)', () => {
    it('creates one activity per attachment, addressed by the attachment _id and MODEL_ATTACHMENT, with the snapshot and actor fields', async () => {
      const createActivity = newCreateActivityMock();

      await recordCascadeAttachmentRemovals(
        { createActivity },
        attachments,
        pageIdToPath,
        actor,
      );

      expect(createActivity).toHaveBeenCalledTimes(3);
      expect(createActivity).toHaveBeenCalledWith({
        action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
        target: 'att-1',
        targetModel: MODEL_ATTACHMENT,
        snapshot: {
          username: 'alice',
          originalName: 'a.png',
          pagePath: '/Sandbox',
          pageId: 'page-1',
          fileSize: 100,
        },
        user: actorUser,
        ip: '192.0.2.10',
        endpoint: '/_api/v3/pages/delete-completely',
      });
    });

    it('records an attachment whose page is not in the map with pagePath left undefined (req 3.3 degradation)', async () => {
      const createActivity = newCreateActivityMock();

      await recordCascadeAttachmentRemovals(
        { createActivity },
        attachments,
        pageIdToPath,
        actor,
      );

      const parametersForUnresolvable = createActivity.mock.calls
        .map(([parameters]) => parameters)
        .find((parameters) => parameters.target === 'att-3');

      expect(parametersForUnresolvable?.snapshot).toStrictEqual({
        username: 'alice',
        originalName: 'c.txt',
        pagePath: undefined,
        pageId: 'page-x',
        fileSize: 300,
      });
    });

    it('leaves ip and endpoint unset when the actor carries only a user (cascade / empty-trash paths)', async () => {
      const createActivity = newCreateActivityMock();

      await recordCascadeAttachmentRemovals(
        { createActivity },
        [attachments[0]],
        pageIdToPath,
        { user: actorUser },
      );

      const [parameters] = createActivity.mock.calls[0];
      expect(parameters.ip).toBeUndefined();
      expect(parameters.endpoint).toBeUndefined();
    });
  });

  describe('recording-scope gating is delegated to createActivity (design: Cascade Recorder)', () => {
    it('still hands every attachment to createActivity and adds no side effect of its own when the gate is closed (createActivity resolves null)', async () => {
      const createActivity = vi
        .fn<ActivityCreator['createActivity']>()
        .mockResolvedValue(null);

      await expect(
        recordCascadeAttachmentRemovals(
          { createActivity },
          attachments,
          pageIdToPath,
          actor,
        ),
      ).resolves.toBeUndefined();

      // Delegation contract: the recorder does not pre-filter — the gate
      // (shoudUpdateActivity) lives inside createActivity, so every
      // attachment is still handed over.
      expect(createActivity).toHaveBeenCalledTimes(3);
      // A closed gate (null result) is a normal outcome, not a failure.
      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });

  describe('failure isolation (design: Error Handling > cascade individual failure)', () => {
    const newRejectingCreateActivityMock = () =>
      vi
        .fn<ActivityCreator['createActivity']>()
        .mockImplementation((parameters) => {
          if (parameters.target === 'att-2') {
            return Promise.reject(new Error('insert failed'));
          }
          return Promise.resolve(mock<IActivity>());
        });

    it('a single rejected createActivity does not stop the remaining records and the recorder resolves', async () => {
      const createActivity = newRejectingCreateActivityMock();

      await expect(
        recordCascadeAttachmentRemovals(
          { createActivity },
          attachments,
          pageIdToPath,
          actor,
        ),
      ).resolves.toBeUndefined();

      expect(createActivity).toHaveBeenCalledTimes(3);
      const attemptedTargets = createActivity.mock.calls.map(
        ([parameters]) => parameters.target,
      );
      expect(attemptedTargets).toEqual(
        expect.arrayContaining(['att-1', 'att-2', 'att-3']),
      );
    });

    it('logs the failure as an error carrying the failed attachment _id as context', async () => {
      const createActivity = newRejectingCreateActivityMock();

      await recordCascadeAttachmentRemovals(
        { createActivity },
        attachments,
        pageIdToPath,
        actor,
      );

      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      // pino convention: structured context object first, message second.
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentId: 'att-2' }),
        expect.any(String),
      );
    });
  });

  describe('target uniqueness (design: Cascade Recorder > Postconditions)', () => {
    it('gives each created activity its own attachment _id as target, so targets are pairwise distinct', async () => {
      const createActivity = newCreateActivityMock();

      await recordCascadeAttachmentRemovals(
        { createActivity },
        attachments,
        pageIdToPath,
        actor,
      );

      const targets = createActivity.mock.calls.map(
        ([parameters]) => parameters.target,
      );
      expect(new Set(targets).size).toBe(attachments.length);
      expect(new Set(targets)).toStrictEqual(
        new Set(['att-1', 'att-2', 'att-3']),
      );
    });
  });

  describe('activityService dependency type', () => {
    it('the real ActivityService instance type is assignable to ActivityCreator (compile-time contract)', () => {
      type Extends<A, B> = A extends B ? true : false;
      // Fails to typecheck if ActivityService.createActivity drifts away from
      // the minimal structural surface the recorder depends on (executor
      // principle: the dependency is injected, not imported).
      const isCompatible: Extends<ActivityService, ActivityCreator> = true;
      expect(isCompatible).toBe(true);
    });
  });
});
