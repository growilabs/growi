import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAttachmentEsDoc } from '~/features/search-attachments/interfaces/attachment-search';

import { AttachmentSearchDelegatorExtension } from './attachment-search-delegator-extension';

// Minimal mock of an ES8 client delegator
function makeClientMock() {
  const mock = {
    delegatorVersion: 8 as const,
    bulk: vi.fn().mockResolvedValue({ errors: false, items: [], took: 1 }),
    deleteByQuery: vi.fn().mockResolvedValue({ deleted: 1, failures: [] }),
    indices: {
      create: vi.fn().mockResolvedValue({ acknowledged: true }),
      exists: vi.fn().mockResolvedValue(false),
      existsAlias: vi.fn().mockResolvedValue(false),
      putAlias: vi.fn().mockResolvedValue({ acknowledged: true }),
      getAlias: vi.fn().mockRejectedValue(
        Object.assign(new Error('alias_missing_exception'), {
          statusCode: 404,
        }),
      ),
    },
  };
  return mock;
}

const SAMPLE_DOC: IAttachmentEsDoc = {
  attachmentId: 'att1',
  pageId: 'page1',
  pageNumber: 1,
  label: 'Page 1',
  fileName: 'doc.pdf',
  originalName: 'document.pdf',
  fileFormat: 'application/pdf',
  fileSize: 1024,
  attachmentType: 'attachment',
  content: 'Sample content from the document',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

describe('AttachmentSearchDelegatorExtension', () => {
  let client: ReturnType<typeof makeClientMock>;
  let ext: AttachmentSearchDelegatorExtension;

  beforeEach(() => {
    client = makeClientMock();
    // biome-ignore lint/suspicious/noExplicitAny: test mock uses a partial client shape
    ext = new AttachmentSearchDelegatorExtension(client as any);
  });

  // ----------------------------------------------------------------
  // createAttachmentIndex
  // ----------------------------------------------------------------
  describe('createAttachmentIndex', () => {
    it('creates the "attachments" index by default', async () => {
      await ext.createAttachmentIndex();
      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'attachments' }),
      );
    });

    it('creates a custom-named index when provided', async () => {
      await ext.createAttachmentIndex('attachments-tmp');
      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'attachments-tmp' }),
      );
    });
  });

  // ----------------------------------------------------------------
  // syncAttachmentIndexed
  // ----------------------------------------------------------------
  describe('syncAttachmentIndexed', () => {
    it('calls bulk with operations for each doc × each target index', async () => {
      const docs = [SAMPLE_DOC];
      await ext.syncAttachmentIndexed('att1', 'page1', docs, [
        'attachments',
        'attachments-tmp',
      ]);

      expect(client.bulk).toHaveBeenCalledOnce();
      // biome-ignore lint/suspicious/noExplicitAny: accessing mock arg properties
      const bulkArg = client.bulk.mock.calls[0][0] as any;

      // For 1 doc × 2 indexes: 2 × (index command + body) = 4 items
      expect(bulkArg.operations ?? bulkArg.body).toHaveLength(4);
    });

    it('constructs doc ID as attachmentId_pageNumber pattern', async () => {
      const docs = [{ ...SAMPLE_DOC, pageNumber: 3 }];
      await ext.syncAttachmentIndexed('att1', 'page1', docs, ['attachments']);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock arg properties
      const bulkArg = client.bulk.mock.calls[0][0] as any;
      const serialized = JSON.stringify(bulkArg.operations ?? bulkArg.body);
      expect(serialized).toContain('att1_3');
    });

    it('uses pageNumber=0 when pageNumber is null', async () => {
      const docs = [{ ...SAMPLE_DOC, pageNumber: null }];
      await ext.syncAttachmentIndexed('att1', 'page1', docs, ['attachments']);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock arg properties
      const bulkArg = client.bulk.mock.calls[0][0] as any;
      const serialized = JSON.stringify(bulkArg.operations ?? bulkArg.body);
      expect(serialized).toContain('att1_0');
    });

    it('does NOT include permission fields in bulk bodies', async () => {
      const docs = [SAMPLE_DOC];
      await ext.syncAttachmentIndexed('att1', 'page1', docs, ['attachments']);

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock arg properties
      const bulkArg = client.bulk.mock.calls[0][0] as any;
      const serialized = JSON.stringify(bulkArg.operations ?? bulkArg.body);
      expect(serialized).not.toContain('"grant"');
      expect(serialized).not.toContain('granted_users');
      expect(serialized).not.toContain('granted_groups');
      expect(serialized).not.toContain('"creator"');
    });

    it('sends one single _bulk call for multiple target indexes', async () => {
      const docs = [SAMPLE_DOC];
      await ext.syncAttachmentIndexed('att1', 'page1', docs, [
        'attachments',
        'attachments-tmp',
      ]);
      // Must be exactly 1 bulk call, not 2
      expect(client.bulk).toHaveBeenCalledOnce();
    });

    it('handles multiple docs across multiple target indexes in one bulk call', async () => {
      const docs = [
        { ...SAMPLE_DOC, pageNumber: 1 },
        { ...SAMPLE_DOC, pageNumber: 2 },
      ];
      await ext.syncAttachmentIndexed('att1', 'page1', docs, [
        'attachments',
        'attachments-tmp',
      ]);

      expect(client.bulk).toHaveBeenCalledOnce();
      // biome-ignore lint/suspicious/noExplicitAny: accessing mock arg properties
      const bulkArg = client.bulk.mock.calls[0][0] as any;
      // 2 docs × 2 indexes = 4 (index+body) pairs = 8 items
      expect(bulkArg.operations ?? bulkArg.body).toHaveLength(8);
    });
  });

  // ----------------------------------------------------------------
  // syncAttachmentRemoved
  // ----------------------------------------------------------------
  describe('syncAttachmentRemoved', () => {
    it('calls deleteByQuery for each target index', async () => {
      await ext.syncAttachmentRemoved('att1', [
        'attachments',
        'attachments-tmp',
      ]);
      expect(client.deleteByQuery).toHaveBeenCalledTimes(2);
    });

    it('passes attachmentId as term filter', async () => {
      await ext.syncAttachmentRemoved('att-x', ['attachments']);
      // biome-ignore lint/suspicious/noExplicitAny: accessing mock arg properties
      const arg = client.deleteByQuery.mock.calls[0][0] as any;
      const serialized = JSON.stringify(arg);
      expect(serialized).toContain('att-x');
      expect(serialized).toContain('attachmentId');
    });
  });

  // ----------------------------------------------------------------
  // searchAttachmentsBody
  // ----------------------------------------------------------------
  describe('searchAttachmentsBody', () => {
    it('returns an object (valid body shape)', () => {
      const body = ext.searchAttachmentsBody('test query', {});
      expect(typeof body).toBe('object');
      expect(body).not.toBeNull();
    });

    it('contains content field references', () => {
      const body = ext.searchAttachmentsBody('hello', {});
      const serialized = JSON.stringify(body);
      expect(serialized).toContain('content');
    });

    it('does NOT contain permission filter fields', () => {
      const body = ext.searchAttachmentsBody('test', {});
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('"grant"');
      expect(serialized).not.toContain('granted_users');
      expect(serialized).not.toContain('granted_groups');
      expect(serialized).not.toContain('"creator"');
    });
  });

  // ----------------------------------------------------------------
  // searchAttachmentsByPageIdsBody
  // ----------------------------------------------------------------
  describe('searchAttachmentsByPageIdsBody', () => {
    it('returns an object', () => {
      const body = ext.searchAttachmentsByPageIdsBody('test', [
        'page1',
        'page2',
      ]);
      expect(typeof body).toBe('object');
    });

    it('includes terms filter on pageId', () => {
      const body = ext.searchAttachmentsByPageIdsBody('test', ['p1', 'p2']);
      const serialized = JSON.stringify(body);
      expect(serialized).toContain('pageId');
      expect(serialized).toContain('p1');
      expect(serialized).toContain('p2');
    });

    it('includes content match clause', () => {
      const body = ext.searchAttachmentsByPageIdsBody('hello', ['page1']);
      const serialized = JSON.stringify(body);
      expect(serialized).toContain('hello');
      expect(serialized).toContain('content');
    });
  });

  // ----------------------------------------------------------------
  // initializeAttachmentIndex
  // ----------------------------------------------------------------
  describe('initializeAttachmentIndex', () => {
    it('creates index and alias when neither exists, returns { initialized: true }', async () => {
      // getAlias throws 404 → alias does not exist
      client.indices.getAlias.mockRejectedValue(
        Object.assign(new Error('alias_missing_exception'), {
          statusCode: 404,
        }),
      );
      // index does not exist
      client.indices.exists.mockResolvedValue(false);
      // alias does not exist on index
      client.indices.existsAlias.mockResolvedValue(false);

      const result = await ext.initializeAttachmentIndex();

      expect(result).toEqual({ initialized: true });
      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'attachments' }),
      );
      expect(client.indices.putAlias).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'attachments', index: 'attachments' }),
      );
    });

    it('returns { initialized: false, reason: "alias_conflict" } when alias points to a foreign index', async () => {
      // getAlias resolves — alias "attachments" points to "some-foreign-index"
      client.indices.getAlias.mockResolvedValue({
        'some-foreign-index': { aliases: { attachments: {} } },
      });

      const result = await ext.initializeAttachmentIndex();

      expect(result).toEqual({ initialized: false, reason: 'alias_conflict' });
      // Must NOT create any index or alias
      expect(client.indices.create).not.toHaveBeenCalled();
      expect(client.indices.putAlias).not.toHaveBeenCalled();
    });

    it('proceeds normally when alias already points to the owned "attachments" index', async () => {
      // getAlias resolves — alias "attachments" points to owned index
      client.indices.getAlias.mockResolvedValue({
        attachments: { aliases: { attachments: {} } },
      });
      // index already exists
      client.indices.exists.mockResolvedValue(true);
      // alias already set on attachments index
      client.indices.existsAlias.mockResolvedValue(true);

      const result = await ext.initializeAttachmentIndex();

      expect(result).toEqual({ initialized: true });
      // Index already exists → create must NOT be called
      expect(client.indices.create).not.toHaveBeenCalled();
      // Alias already set → putAlias must NOT be called
      expect(client.indices.putAlias).not.toHaveBeenCalled();
    });

    it('proceeds normally when alias points to owned "attachments-tmp" index', async () => {
      // getAlias resolves — alias "attachments" points to owned tmp index
      client.indices.getAlias.mockResolvedValue({
        'attachments-tmp': { aliases: { attachments: {} } },
      });
      // index already exists
      client.indices.exists.mockResolvedValue(true);
      // alias already set
      client.indices.existsAlias.mockResolvedValue(true);

      const result = await ext.initializeAttachmentIndex();

      expect(result).toEqual({ initialized: true });
    });
  });

  // ----------------------------------------------------------------
  // mgetPagesForPermissionBody
  // ----------------------------------------------------------------
  describe('mgetPagesForPermissionBody', () => {
    it('returns an object', () => {
      const body = ext.mgetPagesForPermissionBody(['page1', 'page2']);
      expect(typeof body).toBe('object');
    });

    it('includes the required permission-check fields in _source_includes', () => {
      // biome-ignore lint/suspicious/noExplicitAny: inspecting serialised body
      const body = ext.mgetPagesForPermissionBody(['page1']) as any;
      const serialized = JSON.stringify(body);
      // Must include minimal permission fields
      expect(serialized).toContain('grant');
      expect(serialized).toContain('grantedUsers');
      expect(serialized).toContain('grantedGroups');
      expect(serialized).toContain('creator');
      expect(serialized).toContain('path');
      expect(serialized).toContain('title');
      expect(serialized).toContain('updatedAt');
    });

    it('does NOT fetch the page body content', () => {
      // biome-ignore lint/suspicious/noExplicitAny: inspecting serialised body
      const body = ext.mgetPagesForPermissionBody(['page1']) as any;
      const serialized = JSON.stringify(body);
      // Page body (revision body) should NOT be included
      expect(serialized).not.toContain('"body"');
    });

    it('includes pageIds in the ids list', () => {
      const body = ext.mgetPagesForPermissionBody([
        'page-abc',
        'page-def',
        // biome-ignore lint/suspicious/noExplicitAny: inspecting serialised body
      ]) as any;
      const serialized = JSON.stringify(body);
      expect(serialized).toContain('page-abc');
      expect(serialized).toContain('page-def');
    });
  });
});
