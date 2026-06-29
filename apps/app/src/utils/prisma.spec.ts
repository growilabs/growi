/**
 * Unit tests for utils/prisma.ts — paginateLogic helper
 *
 * Tests verify the observable contract of the offset-based paginate helper:
 * - skip is set to offset exactly (not (page-1)*limit)
 * - output always includes offset field
 * - page/totalPages/hasNextPage are consistent with offset/limit
 * - hasPrevPage/prevPage: page===1 && offset!==0 edge case (mongoose-paginate-v2 compat)
 */

import { mock } from 'vitest-mock-extended';

import type { PaginatableDelegate } from './prisma';
import { paginateLogic } from './prisma';

describe('paginateLogic — observable contract', () => {
  let delegate: ReturnType<typeof mock<PaginatableDelegate>>;

  beforeEach(() => {
    delegate = mock<PaginatableDelegate>();
  });

  describe('skip = offset exactly', () => {
    it('passes skip=0 when offset=0', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(0);

      await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('passes skip=offset for any positive offset', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(0);

      await paginateLogic(delegate, { offset: 15, limit: 10 });

      expect(delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 15, take: 10 }),
      );
    });

    it('uses skip=0 when offset is omitted (default)', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(0);

      await paginateLogic(delegate, { limit: 10 });

      expect(delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });
  });

  describe('output always includes offset field', () => {
    it('includes offset=0 in result when offset not specified', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(5);

      const result = await paginateLogic(delegate, { limit: 10 });

      expect(result).toHaveProperty('offset', 0);
    });

    it('includes the exact offset value in result', async () => {
      delegate.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      delegate.count.mockResolvedValue(25);

      const result = await paginateLogic(delegate, { offset: 7, limit: 5 });

      expect(result).toHaveProperty('offset', 7);
    });
  });

  describe('page derivation: Math.ceil((offset+1)/limit)', () => {
    it('offset=0, limit=10 → page=1', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.page).toBe(1);
    });

    it('offset=9, limit=10 → page=1', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 9, limit: 10 });

      expect(result.page).toBe(1);
    });

    it('offset=10, limit=10 → page=2', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(30);

      const result = await paginateLogic(delegate, { offset: 10, limit: 10 });

      expect(result.page).toBe(2);
    });

    it('offset=20, limit=10 → page=3', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(30);

      const result = await paginateLogic(delegate, { offset: 20, limit: 10 });

      expect(result.page).toBe(3);
    });

    it('offset=1, limit=10 → page=1 (still within first page)', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 1, limit: 10 });

      expect(result.page).toBe(1);
    });
  });

  describe('pagingCounter: (page-1)*limit+1', () => {
    it('offset=0, limit=10 → pagingCounter=1', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.pagingCounter).toBe(1);
    });

    it('offset=10, limit=10 → pagingCounter=11', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(30);

      const result = await paginateLogic(delegate, { offset: 10, limit: 10 });

      expect(result.pagingCounter).toBe(11);
    });

    it('offset=20, limit=5 → page=5, pagingCounter=21', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(30);

      const result = await paginateLogic(delegate, { offset: 20, limit: 5 });

      expect(result.page).toBe(5);
      expect(result.pagingCounter).toBe(21);
    });
  });

  describe('totalPages: Math.ceil(totalDocs/limit)', () => {
    it('20 docs, limit 10 → totalPages=2', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.totalPages).toBe(2);
    });

    it('21 docs, limit 10 → totalPages=3', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(21);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.totalPages).toBe(3);
    });

    it('0 docs → totalPages=0', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(0);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.totalPages).toBe(0);
    });
  });

  describe('hasNextPage / nextPage', () => {
    it('page < totalPages → hasNextPage=true, nextPage=page+1', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(30);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.hasNextPage).toBe(true);
      expect(result.nextPage).toBe(2);
    });

    it('last page → hasNextPage=false, nextPage=null', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 10, limit: 10 });

      expect(result.hasNextPage).toBe(false);
      expect(result.nextPage).toBeNull();
    });
  });

  describe('hasPrevPage/prevPage — mongoose-paginate-v2 edge case', () => {
    it('page===1 && offset===0: hasPrevPage=false, prevPage=null', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.hasPrevPage).toBe(false);
      expect(result.prevPage).toBeNull();
    });

    it('page===1 && offset!==0: hasPrevPage=true, prevPage=1 (edge case)', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      // offset=5 with limit=10 → page=Math.ceil(6/10)=1, but offset is non-zero
      const result = await paginateLogic(delegate, { offset: 5, limit: 10 });

      expect(result.page).toBe(1); // page IS 1
      expect(result.hasPrevPage).toBe(true); // but offset != 0
      expect(result.prevPage).toBe(1); // prevPage = 1
    });

    it('page===1 && offset=1 (edge): hasPrevPage=true, prevPage=1', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(20);

      const result = await paginateLogic(delegate, { offset: 1, limit: 10 });

      expect(result.page).toBe(1);
      expect(result.hasPrevPage).toBe(true);
      expect(result.prevPage).toBe(1);
    });

    it('page===2: hasPrevPage=true, prevPage=1 (normal prev)', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(30);

      const result = await paginateLogic(delegate, { offset: 10, limit: 10 });

      expect(result.page).toBe(2);
      expect(result.hasPrevPage).toBe(true);
      expect(result.prevPage).toBe(1);
    });

    it('page===3: hasPrevPage=true, prevPage=2', async () => {
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(30);

      const result = await paginateLogic(delegate, { offset: 20, limit: 10 });

      expect(result.page).toBe(3);
      expect(result.hasPrevPage).toBe(true);
      expect(result.prevPage).toBe(2);
    });
  });

  describe('docs are passed through from findMany result', () => {
    it('returns the docs from findMany', async () => {
      const mockDocs = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];
      delegate.findMany.mockResolvedValue(mockDocs);
      delegate.count.mockResolvedValue(2);

      const result = await paginateLogic(delegate, { offset: 0, limit: 10 });

      expect(result.docs).toEqual(mockDocs);
      expect(result.totalDocs).toBe(2);
    });
  });
});
