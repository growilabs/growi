import { mock } from 'vitest-mock-extended';

import { addTagCondition } from './add-tag-condition.js';
import type { PageQuery } from './generate-base-query.js';

describe('addTagCondition()', () => {
  it('adds an _id $in condition and returns the chained query when pageIds is non-empty', () => {
    // setup
    const pageIds = ['page1', 'page2'];
    const query = mock<PageQuery>();
    const chainedResult = mock<PageQuery>();
    query.and.mockReturnValue(chainedResult);

    // when
    const result = addTagCondition(query, pageIds);

    // then
    expect(query.and).toHaveBeenCalledWith([{ _id: { $in: pageIds } }]);
    expect(result).toEqual(chainedResult);
  });

  it('does not throw and adds an always-false _id $in condition when pageIds is empty', () => {
    // setup
    const pageIds: string[] = [];
    const query = mock<PageQuery>();
    const chainedResult = mock<PageQuery>();
    query.and.mockReturnValue(chainedResult);

    // when
    const caller = () => addTagCondition(query, pageIds);

    // then
    expect(caller).not.toThrow();
    const result = caller();
    expect(query.and).toHaveBeenCalledWith([{ _id: { $in: [] } }]);
    expect(result).toEqual(chainedResult);
  });
});
