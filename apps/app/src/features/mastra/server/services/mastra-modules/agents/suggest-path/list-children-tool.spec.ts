import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { IPageForTreeItem } from '~/interfaces/page';
import { pageListingService } from '~/server/service/page-listing';

import { listChildrenTool } from './list-children-tool';
import type {
  ChildListingBudget,
  SuggestPathRequestContextShape,
} from './request-context';

// Suppress logger noise from the tool under test (mirrors the sibling specs:
// every level is a no-op).
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// The tool delegates to pageListingService; mock the module so the unit test
// never touches Mongo. Only the one method under test is stubbed.
vi.mock('~/server/service/page-listing', () => ({
  pageListingService: {
    findChildrenByParentPathOrIdAndViewer: vi.fn(),
  },
}));

const delegateMock = vi.mocked(
  pageListingService.findChildrenByParentPathOrIdAndViewer,
);

const buildRequestContext =
  (): RequestContext<SuggestPathRequestContextShape> =>
    new RequestContext<SuggestPathRequestContextShape>();

const buildBudget = (limit: number, used = 0): ChildListingBudget => ({
  limit,
  used,
  paths: [],
});

const user = mock<IUserHasId>();

// Discriminated union mirroring the tool's outputSchema, defined locally so
// callers can narrow on `result` without casts.
type ListChildrenToolResult =
  | {
      result: 'ok';
      parentPath: string;
      children: Array<{
        path: string;
        descendantCount: number;
        isEmpty: boolean;
      }>;
      truncated: boolean;
    }
  | {
      result: 'limit_exceeded' | 'context_error' | 'error';
      reason: string;
    };

// Mastra's validateToolInput wrapper returns this envelope when zod input
// validation fails (before execute runs).
type ValidationFailure = { error: true; validationErrors: unknown };

const invokeExecute = async (
  inputData: { parentPath: string },
  requestContext: RequestContext<SuggestPathRequestContextShape>,
): Promise<ListChildrenToolResult | ValidationFailure> => {
  // The Mastra runtime's execute signature is intentionally loose; a single
  // `as never` per arg is unavoidable. Narrow the return shape once.
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await listChildrenTool.execute!(
    inputData as never,
    { requestContext } as never,
  );
  return result as ListChildrenToolResult | ValidationFailure;
};

const isValidationFailure = (
  r: ListChildrenToolResult | ValidationFailure,
): r is ValidationFailure => 'error' in r && r.error === true;

// A grant-aware listing returns IPageForTreeItem entries; build minimal ones
// carrying only the fields the tool projects.
const buildChild = (
  path: string,
  descendantCount: number,
  isEmpty: boolean,
): IPageForTreeItem =>
  mock<IPageForTreeItem>({ path, descendantCount, isEmpty });

describe('listChildrenTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('budget remaining', () => {
    it('delegates to the listing service, increments used, and records the path', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      const budget = buildBudget(5);
      requestContext.set('childListingBudget', budget);
      delegateMock.mockResolvedValue([
        buildChild('/資料/内部仕様/A', 0, false),
        buildChild('/資料/内部仕様/B', 3, false),
      ]);

      const result = await invokeExecute(
        { parentPath: '/資料/内部仕様/' },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      // Budget consumed exactly once and the requested path recorded.
      expect(budget.used).toBe(1);
      expect(budget.paths).toEqual(['/資料/内部仕様/']);
      // The grant-aware listing service is asked for THIS path, on behalf of
      // the calling user (permission filtering is delegated to it).
      expect(delegateMock).toHaveBeenCalledTimes(1);
      expect(delegateMock).toHaveBeenCalledWith('/資料/内部仕様/', user);
    });

    it('projects each child to path/descendantCount/isEmpty and echoes the parentPath', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      requestContext.set('childListingBudget', buildBudget(5));
      delegateMock.mockResolvedValue([
        buildChild('/docs/leaf', 0, false),
        buildChild('/docs/category', 7, true),
      ]);

      const result = await invokeExecute(
        { parentPath: '/docs/' },
        requestContext,
      );

      if (isValidationFailure(result) || result.result !== 'ok') {
        throw new Error('expected ok result');
      }
      expect(result.parentPath).toBe('/docs/');
      expect(result.truncated).toBe(false);
      // The observable contract: only the three structural fields are exposed
      // (descendantCount distinguishes leaf vs sub-category; isEmpty flags a
      // container page). No body field leaks.
      expect(result.children).toEqual([
        { path: '/docs/leaf', descendantCount: 0, isEmpty: false },
        { path: '/docs/category', descendantCount: 7, isEmpty: true },
      ]);
    });

    it('returns an empty children list (not an error) when the path has no children', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      requestContext.set('childListingBudget', buildBudget(5));
      delegateMock.mockResolvedValue([]);

      const result = await invokeExecute(
        { parentPath: '/empty/' },
        requestContext,
      );

      if (isValidationFailure(result) || result.result !== 'ok') {
        throw new Error('expected ok result');
      }
      expect(result.children).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it('caps the children list and flags truncation when the listing is large', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      requestContext.set('childListingBudget', buildBudget(5));
      // 51 children — one over the response cap of 50.
      const many = Array.from({ length: 51 }, (_, i) =>
        buildChild(`/big/child-${i}`, 0, false),
      );
      delegateMock.mockResolvedValue(many);

      const result = await invokeExecute(
        { parentPath: '/big/' },
        requestContext,
      );

      if (isValidationFailure(result) || result.result !== 'ok') {
        throw new Error('expected ok result');
      }
      expect(result.children).toHaveLength(50);
      expect(result.truncated).toBe(true);
    });

    it('records paths in execution order across multiple calls', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      const budget = buildBudget(5);
      requestContext.set('childListingBudget', budget);
      delegateMock.mockResolvedValue([]);

      await invokeExecute({ parentPath: '/first/' }, requestContext);
      await invokeExecute({ parentPath: '/second/' }, requestContext);

      expect(budget.used).toBe(2);
      expect(budget.paths).toEqual(['/first/', '/second/']);
    });
  });

  describe('budget boundary', () => {
    it('lists when one slot remains, then returns limit_exceeded on the next call', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      const budget = buildBudget(1);
      requestContext.set('childListingBudget', budget);
      delegateMock.mockResolvedValue([]);

      const first = await invokeExecute({ parentPath: '/a/' }, requestContext);
      if (isValidationFailure(first)) throw new Error('unexpected');
      expect(first.result).toBe('ok');

      // used (1) === limit (1) -> limit_exceeded WITHOUT delegating again.
      const second = await invokeExecute({ parentPath: '/b/' }, requestContext);
      if (isValidationFailure(second)) throw new Error('unexpected');
      expect(second.result).toBe('limit_exceeded');
      expect(delegateMock).toHaveBeenCalledTimes(1);
      // The rejected attempt neither consumes budget nor pollutes the trace.
      expect(budget.used).toBe(1);
      expect(budget.paths).toEqual(['/a/']);
    });
  });

  describe('context guard', () => {
    it('returns context_error without delegating when user is missing', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('childListingBudget', buildBudget(5));
      // Intentionally do NOT set 'user'.

      const result = await invokeExecute({ parentPath: '/x/' }, requestContext);

      if (isValidationFailure(result)) throw new Error('unexpected');
      expect(result.result).toBe('context_error');
      expect(delegateMock).not.toHaveBeenCalled();
    });

    it('returns context_error without delegating when childListingBudget is missing', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      // Intentionally do NOT set 'childListingBudget'.

      const result = await invokeExecute({ parentPath: '/x/' }, requestContext);

      if (isValidationFailure(result)) throw new Error('unexpected');
      expect(result.result).toBe('context_error');
      expect(delegateMock).not.toHaveBeenCalled();
    });
  });

  describe('never throws', () => {
    it("converts a listing-service rejection into result: 'error' instead of throwing", async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      const budget = buildBudget(5);
      requestContext.set('childListingBudget', budget);
      delegateMock.mockRejectedValue(new Error('listing exploded'));

      await expect(
        invokeExecute({ parentPath: '/boom/' }, requestContext),
      ).resolves.toMatchObject({ result: 'error' });

      // The attempt was made, so budget consumption stands (parity with the
      // search budget's pre-delegation counting).
      expect(budget.used).toBe(1);
      expect(budget.paths).toEqual(['/boom/']);
    });
  });

  describe('input schema', () => {
    it('rejects an empty parentPath at the zod boundary without consuming budget or delegating', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('user', user);
      const budget = buildBudget(5);
      requestContext.set('childListingBudget', budget);

      const result = await invokeExecute({ parentPath: '' }, requestContext);

      expect(isValidationFailure(result)).toBe(true);
      expect(delegateMock).not.toHaveBeenCalled();
      expect(budget.used).toBe(0);
      expect(budget.paths).toEqual([]);
    });
  });
});
