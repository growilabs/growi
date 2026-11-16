import type { estypes } from '@elastic/elasticsearch8';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { IAttachmentEsDoc } from '~/features/search-attachments/interfaces/attachment-search';
import type { ES8ClientDelegator } from '~/server/service/search-delegator/elasticsearch-client-delegator/es8-client-delegator';

import { mappings as es8Mappings } from '../mappings/attachments-mappings-es8';
import {
  AttachmentSearchDelegatorExtension,
  attachmentIndexNames,
} from './attachment-search-delegator-extension';

/** An ES 8 client whose writes succeed; index and alias calls are set per test. */
function makeClientMock(): DeepMockProxy<ES8ClientDelegator> {
  const client = mockDeep<ES8ClientDelegator>();
  client.delegatorVersion = 8;
  client.bulk.mockResolvedValue({ errors: false, items: [], took: 1 });
  client.deleteByQuery.mockResolvedValue({ deleted: 1, failures: [] });
  client.indices.create.mockResolvedValue({
    acknowledged: true,
    shards_acknowledged: true,
    index: 'created',
  });
  return client;
}

const indexNameOf = (index: estypes.Indices | undefined): string =>
  String(index);

/**
 * Backs the client's index and alias APIs with an in-memory set of indices
 * and one alias. `state()` reports which indices exist and which the alias
 * points to.
 */
function installIndicesFake(
  client: DeepMockProxy<ES8ClientDelegator>,
  existing: string[],
  aliased: string[],
) {
  const indices = new Set(existing);
  const aliasTargets = new Set(aliased);
  const notFound = () =>
    Object.assign(new Error('not_found'), { statusCode: 404 });
  const acknowledged = { acknowledged: true };

  client.indices.create.mockImplementation(({ index }) => {
    if (indices.has(index)) {
      return Promise.reject(new Error('resource_already_exists_exception'));
    }
    indices.add(index);
    return Promise.resolve({
      ...acknowledged,
      shards_acknowledged: true,
      index,
    });
  });
  client.indices.delete.mockImplementation(({ index }) => {
    const name = indexNameOf(index);
    if (!indices.delete(name)) return Promise.reject(notFound());
    aliasTargets.delete(name);
    return Promise.resolve(acknowledged);
  });
  client.indices.exists.mockImplementation(({ index }) =>
    Promise.resolve(indices.has(indexNameOf(index))),
  );
  client.indices.existsAlias.mockImplementation(() =>
    Promise.resolve(aliasTargets.size > 0),
  );
  client.indices.getAlias.mockImplementation((params) => {
    if (aliasTargets.size === 0) return Promise.reject(notFound());
    const name = String(params?.name);
    return Promise.resolve(
      Object.fromEntries(
        [...aliasTargets].map((index) => [index, { aliases: { [name]: {} } }]),
      ),
    );
  });
  client.indices.putAlias.mockImplementation(({ index }) => {
    aliasTargets.add(indexNameOf(index));
    return Promise.resolve(acknowledged);
  });
  client.indices.updateAliases.mockImplementation(({ actions }) => {
    for (const action of actions ?? []) {
      if (action.add != null) aliasTargets.add(indexNameOf(action.add.index));
      if (action.remove != null)
        aliasTargets.delete(indexNameOf(action.remove.index));
    }
    return Promise.resolve(acknowledged);
  });

  return {
    state: () => ({
      indices: [...indices].sort(),
      aliased: [...aliasTargets].sort(),
    }),
  };
}

/** The bulk operations of the n-th bulk call, serialized. */
const bulkOperations = (client: DeepMockProxy<ES8ClientDelegator>, call = 0) =>
  client.bulk.mock.calls[call][0].operations ?? [];

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
  let client: DeepMockProxy<ES8ClientDelegator>;
  let ext: AttachmentSearchDelegatorExtension;

  beforeEach(() => {
    client = makeClientMock();
    ext = new AttachmentSearchDelegatorExtension(
      client,
      attachmentIndexNames('growi'),
    );
  });

  // ----------------------------------------------------------------
  // createAttachmentIndex
  // ----------------------------------------------------------------
  describe('createAttachmentIndex', () => {
    it('creates a custom-named index when provided', async () => {
      await ext.createAttachmentIndex('growi-attachments-2');
      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'growi-attachments-2' }),
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
    it('requires the alias to exist for writes through the alias', async () => {
      await ext.syncAttachmentIndexed(
        'att1',
        'page1',
        [SAMPLE_DOC],
        'growi-attachments-alias',
      );

      expect(bulkOperations(client)[0]).toEqual({
        index: {
          _index: 'growi-attachments-alias',
          _id: 'att1_1',
          require_alias: true,
        },
      });
    });

    it('writes to a concrete index without requiring an alias', async () => {
      await ext.syncAttachmentIndexed(
        'att1',
        'page1',
        [SAMPLE_DOC],
        'growi-attachments-2',
      );

      expect(bulkOperations(client)[0]).toEqual({
        index: { _index: 'growi-attachments-2', _id: 'att1_1' },
      });
    });

    it('rejects when Elasticsearch reports failed items', async () => {
      client.bulk.mockResolvedValueOnce({
        errors: true,
        items: [
          {
            index: {
              _index: 'growi-attachments-alias',
              status: 404,
              error: { type: 'index_not_found_exception', reason: 'no alias' },
            },
          },
        ],
        took: 1,
      });

      await expect(
        ext.syncAttachmentIndexed(
          'att1',
          'page1',
          [SAMPLE_DOC],
          'growi-attachments-alias',
        ),
      ).rejects.toThrow('index_not_found_exception');
    });

    it('writes every extracted page in one bulk call, one doc id per page', async () => {
      await ext.syncAttachmentIndexed(
        'att1',
        'page1',
        [
          { ...SAMPLE_DOC, pageNumber: 3 },
          { ...SAMPLE_DOC, pageNumber: null },
        ],
        'growi-attachments-alias',
      );

      expect(client.bulk).toHaveBeenCalledOnce();
      const ids = bulkOperations(client)
        .filter((_, i) => i % 2 === 0)
        .map((op) => JSON.stringify(op));
      expect(ids).toEqual([
        expect.stringContaining('"att1_3"'),
        expect.stringContaining('"att1_0"'),
      ]);
    });

    it('does NOT include permission fields in bulk bodies', async () => {
      await ext.syncAttachmentIndexed(
        'att1',
        'page1',
        [SAMPLE_DOC],
        'growi-attachments-alias',
      );

      const serialized = JSON.stringify(bulkOperations(client));
      expect(serialized).not.toContain('"grant"');
      expect(serialized).not.toContain('granted_users');
      expect(serialized).not.toContain('granted_groups');
      expect(serialized).not.toContain('"creator"');
    });
  });

  describe('removeAttachmentsFromIndex', () => {
    it('refreshes the index first so just-written docs are found, then deletes every given attachment', async () => {
      const order: string[] = [];
      client.indices.refresh.mockImplementation(() => {
        order.push('refresh');
        return Promise.resolve({
          _shards: { total: 1, successful: 1, failed: 0 },
        });
      });
      client.deleteByQuery.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve({ deleted: 2, failures: [] });
      });

      await ext.removeAttachmentsFromIndex(['a1', 'a2'], 'growi-attachments-2');

      expect(order).toEqual(['refresh', 'delete']);
      expect(client.indices.refresh).toHaveBeenCalledWith({
        index: 'growi-attachments-2',
        ignore_unavailable: true,
      });
      expect(client.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'growi-attachments-2',
          query: { terms: { attachmentId: ['a1', 'a2'] } },
        }),
      );
    });

    it('rejects when Elasticsearch reports docs it could not delete', async () => {
      client.deleteByQuery.mockResolvedValue({
        deleted: 0,
        failures: [
          {
            id: 'a1_1',
            index: 'growi-attachments-2',
            status: 409,
            cause: { type: 'version_conflict_engine_exception', reason: 'x' },
          },
        ],
      });

      await expect(
        ext.removeAttachmentsFromIndex(['a1'], 'growi-attachments-2'),
      ).rejects.toThrow('version_conflict_engine_exception');
    });

    it('rejects when the delete fails, so the rebuild does not swap', async () => {
      client.deleteByQuery.mockRejectedValue(new Error('ES is down'));

      await expect(
        ext.removeAttachmentsFromIndex(['a1'], 'growi-attachments-2'),
      ).rejects.toThrow('ES is down');
    });
  });

  // ----------------------------------------------------------------
  // syncAttachmentRemoved
  // ----------------------------------------------------------------
  describe('syncAttachmentRemoved', () => {
    beforeEach(() => {
      client.indices.existsAlias.mockResolvedValue(true);
    });

    it('sends nothing to the alias while it does not exist (the feature was never enabled)', async () => {
      client.indices.existsAlias.mockResolvedValue(false);

      await ext.syncAttachmentRemoved('att1', ['growi-attachments-alias']);

      expect(client.indices.refresh).not.toHaveBeenCalled();
      expect(client.deleteByQuery).not.toHaveBeenCalled();
    });

    it('still deletes from the rebuild index while the alias does not exist', async () => {
      client.indices.existsAlias.mockResolvedValue(false);

      await ext.syncAttachmentRemoved('att1', [
        'growi-attachments-alias',
        'growi-attachments-2',
      ]);

      expect(client.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(client.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'growi-attachments-2' }),
      );
    });

    it('refreshes each index before deleting, so a doc written just before is removed too', async () => {
      const order: string[] = [];
      client.indices.refresh.mockImplementation(({ index } = {}) => {
        order.push(`refresh ${String(index)}`);
        return Promise.resolve({
          _shards: { total: 1, successful: 1, failed: 0 },
        });
      });
      client.deleteByQuery.mockImplementation(({ index }) => {
        order.push(`delete ${String(index)}`);
        return Promise.resolve({ deleted: 1, failures: [] });
      });

      await ext.syncAttachmentRemoved('att1', ['growi-attachments-alias']);

      expect(order).toEqual([
        'refresh growi-attachments-alias',
        'delete growi-attachments-alias',
      ]);
      expect(client.indices.refresh).toHaveBeenCalledWith({
        index: 'growi-attachments-alias',
        ignore_unavailable: true,
      });
    });

    it('calls deleteByQuery for each target index', async () => {
      await ext.syncAttachmentRemoved('att1', [
        'growi-attachments-alias',
        'growi-attachments-2',
      ]);
      expect(client.deleteByQuery).toHaveBeenCalledTimes(2);
    });

    it('tolerates an index that does not exist yet', async () => {
      await ext.syncAttachmentRemoved('att-x', ['growi-attachments-alias']);

      expect(client.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ ignore_unavailable: true }),
      );
    });

    it('passes attachmentId as term filter', async () => {
      await ext.syncAttachmentRemoved('att-x', ['growi-attachments-alias']);
      const serialized = JSON.stringify(client.deleteByQuery.mock.calls[0][0]);
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
      const lifecycleClient = makeClientMock();
      const fake = {
        indices: lifecycleClient.indices,
        ...installIndicesFake(lifecycleClient, existing, aliased),
      };
      const lifecycleExt = new AttachmentSearchDelegatorExtension(
        lifecycleClient,
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
