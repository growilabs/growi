import {
  type AttachmentLike,
  buildAttachmentRemoveSnapshot,
} from './attachment-removal-snapshot';

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
