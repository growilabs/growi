import createError from 'http-errors';
import { mock } from 'vitest-mock-extended';

import { addNumCondition } from './add-num-condition';
import type { PageQuery } from './generate-base-query';

describe('addNumCondition() throws 400 http-errors instance', () => {
  it("when the param 'offset' is a negative value", () => {
    // setup
    const queryMock = mock<PageQuery>();

    // when
    const caller = () => addNumCondition(queryMock, -1, 10);

    // then
    expect(caller).toThrowError(
      createError(400, "The param 'offset' must be larger or equal than 0"),
    );
    expect(queryMock.skip).not.toHaveBeenCalledWith();
    expect(queryMock.limit).not.toHaveBeenCalledWith();
  });
});

describe('addNumCondition() set skip and limit with', () => {
  it.concurrent.each`
    offset        | limit         | expectedSkip | expectedLimit
    ${1}          | ${-1}         | ${1}         | ${null}
    ${0}          | ${0}          | ${null}      | ${0}
    ${0}          | ${10}         | ${null}      | ${10}
    ${Number.NaN} | ${Number.NaN} | ${null}      | ${null}
    ${undefined}  | ${undefined}  | ${null}      | ${50}
  `(
    "{ offset: $offset, limit: $limit }'",
    ({ offset, limit, expectedSkip, expectedLimit }) => {
      // setup
      const queryMock = mock<PageQuery>();

      // result for q.skip()
      const querySkipResultMock = mock<PageQuery>();
      queryMock.skip
        .calledWith(expectedSkip)
        .mockImplementation(() => querySkipResultMock);
      // result for q.limit()
      const queryLimitResultMock = mock<PageQuery>();
      queryMock.limit
        .calledWith(expectedLimit)
        .mockImplementation(() => queryLimitResultMock);
      // result for q.skil().limit()
      const querySkipAndLimitResultMock = mock<PageQuery>();
      querySkipResultMock.limit
        .calledWith(expectedLimit)
        .mockImplementation(() => querySkipAndLimitResultMock);

      // when
      const result = addNumCondition(queryMock, offset, limit);

      // then
      if (expectedSkip != null) {
        expect(queryMock.skip).toHaveBeenCalledWith(expectedSkip);
        if (expectedLimit != null) {
          expect(querySkipResultMock.limit).toHaveBeenCalledWith(expectedLimit);
          expect(result).toEqual(querySkipAndLimitResultMock); // q.skip().limit()
        } else {
          expect(querySkipResultMock.limit).not.toHaveBeenCalled();
          expect(result).toEqual(querySkipResultMock); // q.skil()
        }
      } else {
        expect(queryMock.skip).not.toHaveBeenCalled();
        if (expectedLimit != null) {
          expect(queryMock.limit).toHaveBeenCalledWith(expectedLimit);
          expect(result).toEqual(queryLimitResultMock); // q.limit()
        } else {
          expect(queryMock.limit).not.toHaveBeenCalled();
          expect(result).toEqual(queryMock); // as-is
        }
      }
    },
  );
});
