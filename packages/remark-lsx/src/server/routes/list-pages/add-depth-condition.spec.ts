import type { ParseRangeResult } from '@growi/core/dist/remark-plugins';
import { mock } from 'vitest-mock-extended';

import { addDepthCondition } from './add-depth-condition';
import type { PageQuery } from './generate-base-query';

// mocking modules
const mocks = vi.hoisted(() => {
  return {
    getDepthOfPathMock: vi.fn(),
  };
});

vi.mock('../../../utils/depth-utils', () => ({
  getDepthOfPath: mocks.getDepthOfPathMock,
}));

describe('addDepthCondition()', () => {
  it('returns query as-is', () => {
    // setup
    const query = mock<PageQuery>();

    // when
    const result = addDepthCondition(query, '/', null);

    // then
    expect(result).toEqual(query);
  });

  describe('throws http-errors instance', () => {
    it('when the start is smaller than 1', () => {
      // setup
      const query = mock<PageQuery>();
      const depthRange = mock<ParseRangeResult>();
      depthRange.start = -1;
      depthRange.end = 10;

      // when
      const caller = () => addDepthCondition(query, '/', depthRange);

      // then
      expect(caller).toThrowError(
        new Error(
          "The specified option 'depth' is { start: -1, end: 10 } : the start must be larger or equal than 1",
        ),
      );
      expect(mocks.getDepthOfPathMock).not.toHaveBeenCalled();
    });
  });
});
