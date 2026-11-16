import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAttachmentEsDoc } from '~/features/search-attachments/interfaces/attachment-search';

import { mappings as es8Mappings } from '../mappings/attachments-mappings-es8';
import {
  AttachmentSearchDelegatorExtension,
  attachmentIndexNames,
} from './attachment-search-delegator-extension';

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

/**
 * In-memory stand-in for the ES index and alias APIs, holding one alias.
 * `state()` reports which indices exist and which the alias points to.
 */
function makeIndicesFake(existing: string[], aliased: string[]) {
  const indices = new Set(existing);
  const aliasTargets = new Set(aliased);
  const notFound = () =>
    Object.assign(new Error('not_found'), { statusCode: 404 });
  // Wraps a synchronous body as an async ES API call
  const api = <A, R>(body: (args: A) => R) =>
    vi.fn((args: A): Promise<R> => {
      try {
        return Promise.resolve(body(args));
      } catch (err) {
        return Promise.reject(err);
      }
    });
  return {
    indices: {
      create: api(({ index }: { index: string }) => {
        if (indices.has(index)) {
          throw new Error('resource_already_exists_exception');
        }
        indices.add(index);
        return { acknowledged: true };
      }),
      delete: api(({ index }: { index: string }) => {
        if (!indices.delete(index)) throw notFound();
        aliasTargets.delete(index);
        return { acknowledged: true };
      }),
      exists: api(({ index }: { index: string }) => indices.has(index)),
      existsAlias: api(() => aliasTargets.size > 0),
      getAlias: api(({ name }: { name: string }) => {
        if (aliasTargets.size === 0) throw notFound();
        return Object.fromEntries(
          [...aliasTargets].map((index) => [
            index,
            { aliases: { [name]: {} } },
          ]),
        );
      }),
      putAlias: api(({ index }: { index: string }) => {
        aliasTargets.add(index);
        return { acknowledged: true };
      }),
      updateAliases: api(
        ({
          actions,
        }: {
          actions: Array<{
            add?: { index: string };
            remove?: { index: string };
          }>;
        }) => {
          for (const action of actions) {
            if (action.add != null) aliasTargets.add(action.add.index);
            if (action.remove != null) aliasTargets.delete(action.remove.index);
          }
          return { acknowledged: true };
        },
      ),
    },
    state: () => ({
      indices: [...indices].sort(),
      aliased: [...aliasTargets].sort(),
    }),
  };
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
    ext = new AttachmentSearchDelegatorExtension(
      // biome-ignore lint/suspicious/noExplicitAny: test mock uses a partial client shape
      client as any,
      attachmentIndexNames('growi'),
    );
  });

  // ----------------------------------------------------------------
  // createAttachmentIndex
  // ----------------------------------------------------------------
  describe('createAttachmentIndex', () => {
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
  describe('attachmentIndexNames', () => {
    it('derives every attachment index name from the page index name', () => {
      expect(attachmentIndexNames('tenant-a')).toEqual({
        alias: 'tenant-a-attachments-alias',
        indices: ['tenant-a-attachments-1', 'tenant-a-attachments-2'],
      });
    });

    it('exposes the alias that reads and live writes go through', () => {
      expect(ext.aliasName).toBe('growi-attachments-alias');
    });
  });

  describe('syncAttachmentIndexed', () => {
    it('requires the alias to exist for writes through the alias only', async () => {
      await ext.syncAttachmentIndexed(
        'att1',
        'page1',
        [SAMPLE_DOC],
        ['growi-attachments-alias', 'growi-attachments-2'],
      );

      // biome-ignore lint/suspicious/noExplicitAny: accessing mock arg properties
      const { operations } = client.bulk.mock.calls[0][0] as any;
      expect(operations[0]).toEqual({
        index: {
          _index: 'growi-attachments-alias',
          _id: 'att1_1',
          require_alias: true,
        },
      });
      expect(operations[2]).toEqual({
        index: { _index: 'growi-attachments-2', _id: 'att1_1' },
      });
    });

    it('rejects when Elasticsearch reports failed items', async () => {
      client.bulk.mockResolvedValueOnce({
        errors: true,
        items: [{ index: { error: { type: 'index_not_found_exception' } } }],
        took: 1,
      });

      await expect(
        ext.syncAttachmentIndexed(
          'att1',
          'page1',
          [SAMPLE_DOC],
          ['growi-attachments-alias'],
        ),
      ).rejects.toThrow();
    });

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

    it('tolerates an index that does not exist yet', async () => {
      await ext.syncAttachmentRemoved('att-x', ['attachments']);

      expect(client.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ ignore_unavailable: true }),
      );
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
  // Index lifecycle (alias over two alternating physical indices)
  // ----------------------------------------------------------------
  describe('index lifecycle', () => {
    const NAMES = {
      alias: 'att-alias',
      indices: ['att-1', 'att-2'],
    } as const;

    const setup = (existing: string[], aliased: string[]) => {
      const fake = makeIndicesFake(existing, aliased);
      const lifecycleExt = new AttachmentSearchDelegatorExtension(
        // biome-ignore lint/suspicious/noExplicitAny: test mock uses a partial client shape
        { delegatorVersion: 8, indices: fake.indices } as any,
        NAMES,
      );
      return { fake, lifecycleExt };
    };

    describe('ensureAttachmentIndex', () => {
      it('creates the first index with the attachment mappings and points the alias at it', async () => {
        const { fake, lifecycleExt } = setup([], []);

        await lifecycleExt.ensureAttachmentIndex();

        expect(fake.state()).toEqual({
          indices: ['att-1'],
          aliased: ['att-1'],
        });
        expect(fake.indices.create).toHaveBeenCalledWith({
          index: 'att-1',
          ...es8Mappings,
        });
      });

      it('leaves an existing alias where it is', async () => {
        const { fake, lifecycleExt } = setup(['att-2'], ['att-2']);

        await lifecycleExt.ensureAttachmentIndex();

        expect(fake.state()).toEqual({
          indices: ['att-2'],
          aliased: ['att-2'],
        });
      });
    });

    describe('createRebuildIndex', () => {
      it.each([
        { live: 'att-1', expected: 'att-2' },
        { live: 'att-2', expected: 'att-1' },
      ])('builds into the index the alias does not point to ($live → $expected)', async ({
        live,
        expected,
      }) => {
        const { fake, lifecycleExt } = setup([live], [live]);

        const target = await lifecycleExt.createRebuildIndex();

        expect(target).toBe(expected);
        expect(fake.state()).toEqual({
          indices: ['att-1', 'att-2'],
          aliased: [live],
        });
      });

      it('replaces a leftover from an interrupted rebuild with a fresh index', async () => {
        const { fake, lifecycleExt } = setup(['att-1', 'att-2'], ['att-1']);

        await lifecycleExt.createRebuildIndex();

        expect(fake.indices.delete).toHaveBeenCalledWith({ index: 'att-2' });
        expect(fake.indices.create).toHaveBeenCalledWith(
          expect.objectContaining({ index: 'att-2' }),
        );
      });
    });

    describe('swapAttachmentAlias', () => {
      it('moves the alias in one atomic call and deletes the previous index', async () => {
        const { fake, lifecycleExt } = setup(['att-1', 'att-2'], ['att-1']);

        await lifecycleExt.swapAttachmentAlias('att-2');

        expect(fake.state()).toEqual({
          indices: ['att-2'],
          aliased: ['att-2'],
        });
        expect(fake.indices.updateAliases).toHaveBeenCalledOnce();
      });

      it('points a missing alias at the new index', async () => {
        const { fake, lifecycleExt } = setup(['att-1'], []);

        await lifecycleExt.swapAttachmentAlias('att-1');

        expect(fake.state()).toEqual({
          indices: ['att-1'],
          aliased: ['att-1'],
        });
      });
    });

    describe('dropRebuildIndex', () => {
      it('deletes an index the alias does not point to', async () => {
        const { fake, lifecycleExt } = setup(['att-1', 'att-2'], ['att-1']);

        await lifecycleExt.dropRebuildIndex('att-2');

        expect(fake.state()).toEqual({
          indices: ['att-1'],
          aliased: ['att-1'],
        });
      });

      it('never deletes the index the alias points to', async () => {
        const { fake, lifecycleExt } = setup(['att-1'], ['att-1']);

        await lifecycleExt.dropRebuildIndex('att-1');

        expect(fake.state()).toEqual({
          indices: ['att-1'],
          aliased: ['att-1'],
        });
      });
    });
  });
});
