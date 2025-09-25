import type { IPageHasId, IUser } from '@growi/core';
import type { Request, Response } from 'express';
import createError from 'http-errors';
import { mock } from 'vitest-mock-extended';

import type { LsxApiParams, LsxApiResponseData } from '../../../interfaces/api';
import { addFilterCondition, listPages } from '.';
import type { PageQuery, PageQueryBuilder } from './generate-base-query';

interface IListPagesRequest
  extends Request<undefined, undefined, undefined, LsxApiParams> {
  user: IUser;
}

// mocking modules
const mocks = vi.hoisted(() => {
  return {
    addNumConditionMock: vi.fn(),
    addSortConditionMock: vi.fn(),
    generateBaseQueryMock: vi.fn(),
    getToppageViewersCountMock: vi.fn(),
  };
});

vi.mock('./add-num-condition', () => ({
  addNumCondition: mocks.addNumConditionMock,
}));
vi.mock('./add-sort-condition', () => ({
  addSortCondition: mocks.addSortConditionMock,
}));
vi.mock('./generate-base-query', () => ({
  generateBaseQuery: mocks.generateBaseQueryMock,
}));
vi.mock('./get-toppage-viewers-count', () => ({
  getToppageViewersCount: mocks.getToppageViewersCountMock,
}));

describe('listPages', () => {
  it("returns 400 HTTP response when the query 'pagePath' is undefined", async () => {
    // setup
    const reqMock = mock<IListPagesRequest>();
    const resMock = mock<Response>();
    const resStatusMock = mock<Response>();
    resMock.status.calledWith(400).mockReturnValue(resStatusMock);

    // when
    await listPages(reqMock, resMock);

    // then
    expect(resMock.status).toHaveBeenCalledOnce();
    expect(resStatusMock.send).toHaveBeenCalledOnce();
    expect(mocks.generateBaseQueryMock).not.toHaveBeenCalled();
  });

  describe('with num option', () => {
    const reqMock = mock<IListPagesRequest>();
    reqMock.query = { pagePath: '/Sandbox' };

    const builderMock = mock<PageQueryBuilder>();

    mocks.generateBaseQueryMock.mockResolvedValue(builderMock);
    mocks.getToppageViewersCountMock.mockImplementation(() => 99);

    const queryMock = mock<PageQuery>();
    builderMock.query = queryMock;

    it('returns 200 HTTP response', async () => {
      // setup query.clone().count()
      const queryClonedMock = mock<PageQuery>();
      queryMock.clone.mockReturnValue(queryClonedMock);
      queryClonedMock.count.mockResolvedValue(9);

      // setup addNumCondition
      mocks.addNumConditionMock.mockImplementation(() => queryMock);
      // setup addSortCondition
      mocks.addSortConditionMock.mockImplementation(() => queryMock);

      // setup query.exec()
      const pageMock = mock<IPageHasId>();
      queryMock.exec.mockResolvedValue([pageMock]);
      mocks.addSortConditionMock.mockImplementation(() => queryMock);

      const resMock = mock<Response>();
      const resStatusMock = mock<Response>();
      resMock.status.calledWith(200).mockReturnValue(resStatusMock);

      // when
      await listPages(reqMock, resMock);

      // then
      expect(mocks.generateBaseQueryMock).toHaveBeenCalledOnce();
      expect(mocks.getToppageViewersCountMock).toHaveBeenCalledOnce();
      expect(mocks.addNumConditionMock).toHaveBeenCalledOnce();
      expect(mocks.addSortConditionMock).toHaveBeenCalledOnce();
      expect(resMock.status).toHaveBeenCalledOnce();
      const expectedResponseData: LsxApiResponseData = {
        pages: [pageMock],
        cursor: 1,
        total: 9,
        toppageViewersCount: 99,
      };
      expect(resStatusMock.send).toHaveBeenCalledWith(expectedResponseData);
    });

    it('returns 500 HTTP response when an unexpected error occured', async () => {
      // setup
      const reqMock = mock<IListPagesRequest>();
      reqMock.query = { pagePath: '/Sandbox' };

      // an Error instance will be thrown by addNumConditionMock
      const error = new Error('error for test');
      mocks.addNumConditionMock.mockImplementation(() => {
        throw error;
      });

      const resMock = mock<Response>();
      const resStatusMock = mock<Response>();
      resMock.status.calledWith(500).mockReturnValue(resStatusMock);

      // when
      await listPages(reqMock, resMock);

      // then
      expect(mocks.generateBaseQueryMock).toHaveBeenCalledOnce();
      expect(mocks.getToppageViewersCountMock).toHaveBeenCalledOnce();
      expect(mocks.addNumConditionMock).toHaveBeenCalledOnce(); // throw an error
      expect(mocks.addSortConditionMock).not.toHaveBeenCalledOnce(); // does not called
      expect(resMock.status).toHaveBeenCalledOnce();
      expect(resStatusMock.send).toHaveBeenCalledWith(
        'An internal server error occurred.',
      );
    });

    it('returns 400 HTTP response when the value is invalid', async () => {
      // setup
      const reqMock = mock<IListPagesRequest>();
      reqMock.query = { pagePath: '/Sandbox' };

      // an http-errors instance will be thrown by addNumConditionMock
      const error = createError(400, 'error for test');
      mocks.addNumConditionMock.mockImplementation(() => {
        throw error;
      });

      const resMock = mock<Response>();
      const resStatusMock = mock<Response>();
      resMock.status.calledWith(400).mockReturnValue(resStatusMock);

      // when
      await listPages(reqMock, resMock);

      // then
      expect(mocks.generateBaseQueryMock).toHaveBeenCalledOnce();
      expect(mocks.getToppageViewersCountMock).toHaveBeenCalledOnce();
      expect(mocks.addNumConditionMock).toHaveBeenCalledOnce(); // throw an error
      expect(mocks.addSortConditionMock).not.toHaveBeenCalledOnce(); // does not called
      expect(resMock.status).toHaveBeenCalledOnce();
      expect(resStatusMock.send).toHaveBeenCalledWith('error for test');
    });
  });

  describe('addFilterCondition', () => {
    const queryMock = mock<PageQuery>();
    // and method returns mock itself
    queryMock.and.mockReturnValue(queryMock);

    beforeEach(() => {
      queryMock.and.mockClear();
    });

    it('should call query.and with the correct regex when filter starts with "^"', () => {
      // setup
      const pagePath = '/parent';
      const optionsFilter = '^child';
      const expectedRegex = /^\/parent\/child/;

      // when
      addFilterCondition(queryMock, pagePath, optionsFilter);

      // then
      expect(queryMock.and).toHaveBeenCalledWith({ path: expectedRegex });
    });

    it('should call query.and with the correct regex when filter does not start with "^"', () => {
      // setup
      const pagePath = '/parent';
      const optionsFilter = 'child';
      const expectedRegex = /^\/parent\/.*child/;

      // when
      addFilterCondition(queryMock, pagePath, optionsFilter);

      // then
      expect(queryMock.and).toHaveBeenCalledWith({ path: expectedRegex });
    });

    it('should properly escape regex meta-characters like "[" in filter', () => {
      // setup
      const pagePath = '/parent';
      const optionsFilter = '['; // Invalid regex
      const expectedRex = /^\/parent\/.*\[/;

      // when
      addFilterCondition(queryMock, pagePath, optionsFilter);

      // then
      expect(queryMock.and).toHaveBeenCalledWith({ path: expectedRex });
    });

    it('should call query.and with "$not" when isExceptFilter is true', () => {
      // setup
      const pagePath = '/parent';
      const optionsFilter = 'child';
      const expectedRegex = /^\/parent\/.*child/;

      // when
      addFilterCondition(queryMock, pagePath, optionsFilter, true);

      // then
      expect(queryMock.and).toHaveBeenCalledWith({
        path: { $not: expectedRegex },
      });
    });

    it('should throw an error when optionsFilter is null', () => {
      // setup
      const pagePath = '/parent';

      // when & then
      expect(() => addFilterCondition(queryMock, pagePath, null)).toThrow(
        createError(400, 'filter option require value in regular expression.'),
      );
    });

    it('should throw an error when optionsFilter is true', () => {
      // setup
      const pagePath = '/parent';

      // when & then
      expect(() => addFilterCondition(queryMock, pagePath, true)).toThrow(
        createError(400, 'filter option require value in regular expression.'),
      );
    });
  });
});
