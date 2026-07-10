import {
  type AttachmentLike,
  buildAttachmentSnapshot,
  resolveAttachmentPagePath,
} from './attachment-snapshot';

const { mockLoggerWarn, mockFindById } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockFindById: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  }),
}));

// The resolver reaches the Page model through mongoose.model('Page') at call
// time; stubbing that boundary keeps the unit test DB-free.
vi.mock('mongoose', () => ({
  default: {
    model: () => ({ findById: mockFindById }),
  },
}));

describe('buildAttachmentSnapshot', () => {
  const attachment: AttachmentLike = {
    _id: '662e5f0e1d3c2a0012345678',
    originalName: 'diagram.png',
    fileSize: 2048,
    pageId: '507f191e810c19729de860ea',
  };

  describe('when every input is available (req 6.1, 6.2 shape shared with REMOVE)', () => {
    it('returns a snapshot holding the four attachment fields and the operator username, and nothing else', () => {
      const snapshot = buildAttachmentSnapshot(
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
      const snapshot = buildAttachmentSnapshot(
        { ...attachment, fileSize: 0 },
        '/Sandbox/attachments',
        'alice',
      );

      expect(snapshot.fileSize).toBe(0);
    });
  });

  describe('when inputs are partially missing (req 6.4, 7.3 graceful degradation)', () => {
    it('leaves pagePath and username unresolved while keeping the fields it could resolve', () => {
      const snapshot = buildAttachmentSnapshot(
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

      const snapshot = buildAttachmentSnapshot(minimal, undefined, undefined);

      expect(snapshot.username).toBeUndefined();
      expect(snapshot.originalName).toBeUndefined();
      expect(snapshot.pagePath).toBeUndefined();
      expect(snapshot.pageId).toBeUndefined();
      expect(snapshot.fileSize).toBeUndefined();
    });
  });

  describe('page -> pageId caller contract (canonical home of the pitfall)', () => {
    // Mongoose attachment docs hold their page reference as `page`
    // (ObjectId), while the builder reads only the Prisma alias `pageId`.
    // The un-mapped doc still satisfies AttachmentLike structurally
    // (pageId is optional), so the type checker cannot catch the missing
    // mapping — this test pins that the omission is silent.
    it('silently omits pageId when a Mongoose-shaped attachment is passed without mapping page -> pageId', () => {
      const mongooseShapedDoc = {
        _id: '662e5f0e1d3c2a0012345678',
        originalName: 'diagram.png',
        fileSize: 2048,
        page: '507f191e810c19729de860ea',
      };

      const snapshot = buildAttachmentSnapshot(
        mongooseShapedDoc,
        '/Sandbox/attachments',
        'alice',
      );

      expect(snapshot.pageId).toBeUndefined();
    });
  });

  describe('purity', () => {
    it('returns a new object and never mutates its inputs', () => {
      // Freezing makes any mutation attempt throw (ESM strict mode).
      const frozen: AttachmentLike = Object.freeze({ ...attachment });
      const inputCopy = { ...frozen };

      const snapshot = buildAttachmentSnapshot(
        frozen,
        '/Sandbox/attachments',
        'alice',
      );

      expect(snapshot).not.toBe(frozen);
      expect(frozen).toStrictEqual(inputCopy);
    });
  });
});

describe('resolveAttachmentPagePath', () => {
  const PAGE_ID = '507f191e810c19729de860ea';
  const ATTACHMENT_ID = '662e5f0e1d3c2a0012345678';

  beforeEach(() => {
    mockLoggerWarn.mockClear();
    mockFindById.mockReset();
  });

  describe('when the page is found', () => {
    it('returns the path of the page looked up by the given page reference, without warning', async () => {
      mockFindById.mockResolvedValue({ path: '/Sandbox/attachments' });

      const pagePath = await resolveAttachmentPagePath(PAGE_ID, {
        attachmentId: ATTACHMENT_ID,
      });

      expect(pagePath).toBe('/Sandbox/attachments');
      expect(mockFindById).toHaveBeenCalledWith(PAGE_ID);
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });
  });

  describe('when the page is not found (req 6.4, 7.3 degradation)', () => {
    it('returns undefined and warns once with attachmentId/pageId as structured fields (pino context-first)', async () => {
      mockFindById.mockResolvedValue(null);

      const pagePath = await resolveAttachmentPagePath(PAGE_ID, {
        attachmentId: ATTACHMENT_ID,
      });

      expect(pagePath).toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      // pino convention: structured context object first, message second —
      // a string-first call would silently discard the context fields.
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          attachmentId: ATTACHMENT_ID,
          pageId: PAGE_ID,
        }),
        expect.any(String),
      );
    });

    it('still warns context-first with pageId when the caller passes no attachmentId context', async () => {
      mockFindById.mockResolvedValue(null);

      const pagePath = await resolveAttachmentPagePath(PAGE_ID);

      expect(pagePath).toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ pageId: PAGE_ID }),
        expect.any(String),
      );
    });
  });

  describe('when the page lookup fails (DB error)', () => {
    it('swallows the error, returns undefined, and warns with err/attachmentId/pageId as structured fields', async () => {
      mockFindById.mockRejectedValue(new Error('db down'));

      await expect(
        resolveAttachmentPagePath(PAGE_ID, { attachmentId: ATTACHMENT_ID }),
      ).resolves.toBeUndefined();

      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          attachmentId: ATTACHMENT_ID,
          pageId: PAGE_ID,
        }),
        expect.any(String),
      );
    });
  });

  describe('when the attachment has no page reference (e.g. profile image)', () => {
    it('returns undefined silently without looking up any page', async () => {
      const pagePath = await resolveAttachmentPagePath(undefined, {
        attachmentId: ATTACHMENT_ID,
      });

      expect(pagePath).toBeUndefined();
      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });
  });
});
