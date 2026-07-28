import { RequestContext } from '@mastra/core/request-context';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { fullTextSearchTool } from '../../tools/full-text-search-tool';
import { limitedSearchTool } from './limited-search-tool';
import type {
  SearchBudget,
  SuggestPathRequestContextShape,
} from './request-context';

// Suppress logger noise from the tool under test. The factory shape mirrors
// other specs (e.g. full-text-search-tool.spec.ts) — every level is a no-op.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// The wrapper module imports fullTextSearchTool, whose module loads Mongoose
// models at the top level. Mock them so loading the delegate module stays
// safe in the unit environment (no DB). They are never called in these tests
// because the delegate's execute itself is replaced with a spy.
vi.mock('~/server/models/user-group-relation', () => ({
  default: {
    findAllUserGroupIdsRelatedToUser: vi.fn(),
  },
}));

vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: {
      findAllUserGroupIdsRelatedToUser: vi.fn(),
    },
  }),
);

// Helper to construct a typed RequestContext used by the wrapper tool.
const buildRequestContext =
  (): RequestContext<SuggestPathRequestContextShape> =>
    new RequestContext<SuggestPathRequestContextShape>();

const buildBudget = (limit: number, used = 0): SearchBudget => ({
  limit,
  used,
  queries: [],
});

// Discriminated union mirroring the wrapper's outputSchema: the original
// tool's union (ok / error / context_error) extended with limit_exceeded.
// Defined locally so callers can narrow on `result` without casts.
type LimitedSearchToolResult =
  | {
      result: 'ok';
      hits: Array<{ pageId: string; pagePath: string; snippet?: string }>;
      totalCount: number;
    }
  | { result: 'error' | 'context_error' | 'limit_exceeded'; reason: string };

// Mastra's validateToolInput wrapper returns this envelope shape (not the
// discriminated union) when zod input validation fails.
type ValidationFailure = { error: true; validationErrors: unknown };

// Invoke the wrapper's execute. The mastra runtime calls execute with
// `(inputData, { requestContext, ... })`, so tests mirror that shape.
const invokeExecute = async (
  inputData: {
    query: string;
    limit?: number;
    sort?: string;
    order?: string;
  },
  requestContext: RequestContext<SuggestPathRequestContextShape>,
): Promise<LimitedSearchToolResult | ValidationFailure> => {
  // The Mastra runtime's `execute` signature is intentionally loose
  // (`unknown` input / output), so a single `as never` per arg is unavoidable
  // here. Narrow the return shape ONCE so callers don't repeat the cast.
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await limitedSearchTool.execute!(
    inputData as never,
    { requestContext } as never,
  );
  return result as LimitedSearchToolResult | ValidationFailure;
};

// Type-guard to discriminate the validation envelope from the success/error
// discriminated union without a cast at the call site.
const isValidationFailure = (
  r: LimitedSearchToolResult | ValidationFailure,
): r is ValidationFailure => 'error' in r && r.error === true;

const okDelegateValue = {
  result: 'ok' as const,
  hits: [{ pageId: 'p1', pagePath: '/page1', snippet: 'snip' }],
  totalCount: 1,
};

describe('limitedSearchTool', () => {
  // Spy on the delegate's execute so the wrapper's delegation contract is
  // observable without exercising the delegate's own internals (those are
  // covered by full-text-search-tool.spec.ts).
  let delegateSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    delegateSpy = vi.spyOn(fullTextSearchTool, 'execute');
    delegateSpy.mockResolvedValue(okDelegateValue);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('budget remaining', () => {
    it('delegates to fullTextSearchTool, increments used, and records the query', async () => {
      const requestContext = buildRequestContext();
      const budget = buildBudget(5);
      requestContext.set('searchBudget', budget);

      const result = await invokeExecute(
        { query: 'growi search', limit: 5 },
        requestContext,
      );

      // Delegate result is passed through unchanged.
      expect(result).toEqual(okDelegateValue);
      expect(delegateSpy).toHaveBeenCalledTimes(1);
      // Budget consumed exactly once and the executed query is recorded
      // (Requirement 3.1 counting + Requirement 2.4 trace).
      expect(budget.used).toBe(1);
      expect(budget.queries).toEqual(['growi search']);
    });

    it('forwards the validated inputData (zod defaults applied) and the same requestContext to the delegate', async () => {
      const requestContext = buildRequestContext();
      requestContext.set('searchBudget', buildBudget(5));

      // Omit limit / sort / order: the wrapper's input schema must behave
      // exactly like the original tool's (defaults included) since they ARE
      // the same schema.
      await invokeExecute({ query: 'hello' }, requestContext);

      expect(delegateSpy).toHaveBeenCalledTimes(1);
      // 1st arg: validated input with the original schema's defaults.
      expect(delegateSpy.mock.calls[0][0]).toEqual({
        query: 'hello',
        limit: 10,
        sort: 'relationScore',
        order: 'desc',
      });
      // 2nd arg: the context envelope is forwarded so the delegate reads the
      // SAME requestContext (user propagation — permission filtering stays
      // the delegate's responsibility, Requirement 1.5).
      expect(delegateSpy.mock.calls[0][1].requestContext).toBe(requestContext);
    });

    it('still counts the search and records the query when the delegate returns an error value', async () => {
      const requestContext = buildRequestContext();
      const budget = buildBudget(3);
      requestContext.set('searchBudget', budget);
      delegateSpy.mockResolvedValue({
        result: 'error' as const,
        reason: 'search_failed',
      });

      const result = await invokeExecute(
        { query: 'failing query', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('error');
      // Consumption happens BEFORE delegation: a failed search attempt still
      // spends budget and appears in the trace.
      expect(budget.used).toBe(1);
      expect(budget.queries).toEqual(['failing query']);
    });

    it('records queries in execution order across multiple calls', async () => {
      const requestContext = buildRequestContext();
      const budget = buildBudget(5);
      requestContext.set('searchBudget', budget);

      await invokeExecute({ query: 'first', limit: 5 }, requestContext);
      await invokeExecute({ query: 'second', limit: 5 }, requestContext);

      expect(budget.used).toBe(2);
      expect(budget.queries).toEqual(['first', 'second']);
    });
  });

  describe('budget boundary', () => {
    it('delegates when exactly one slot remains, then returns limit_exceeded on the next call', async () => {
      const requestContext = buildRequestContext();
      const budget = buildBudget(2);
      requestContext.set('searchBudget', budget);

      // Calls 1 and 2 consume the budget (used: 0 -> 1 -> 2).
      const first = await invokeExecute(
        { query: 'q1', limit: 5 },
        requestContext,
      );
      const second = await invokeExecute(
        { query: 'q2', limit: 5 },
        requestContext,
      );
      expect(first).toEqual(okDelegateValue);
      expect(second).toEqual(okDelegateValue);
      expect(delegateSpy).toHaveBeenCalledTimes(2);

      // Call 3: used (2) === limit (2) -> limit_exceeded WITHOUT delegating.
      const third = await invokeExecute(
        { query: 'q3', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(third)).toBe(false);
      if (isValidationFailure(third)) return;
      expect(third.result).toBe('limit_exceeded');
      if (third.result !== 'ok') {
        expect(typeof third.reason).toBe('string');
        expect(third.reason.length).toBeGreaterThan(0);
      }
      expect(delegateSpy).toHaveBeenCalledTimes(2);
      // The rejected attempt neither consumes budget nor pollutes the trace.
      expect(budget.used).toBe(2);
      expect(budget.queries).toEqual(['q1', 'q2']);
    });

    it('returns limit_exceeded without delegating when used already equals limit', async () => {
      const requestContext = buildRequestContext();
      const budget: SearchBudget = {
        limit: 3,
        used: 3,
        queries: ['a', 'b', 'c'],
      };
      requestContext.set('searchBudget', budget);

      const result = await invokeExecute(
        { query: 'over', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('limit_exceeded');
      expect(delegateSpy).not.toHaveBeenCalled();
      expect(budget.used).toBe(3);
      expect(budget.queries).toEqual(['a', 'b', 'c']);
    });
  });

  describe('context guard', () => {
    it('returns context_error without delegating when searchBudget is missing from requestContext', async () => {
      const requestContext = buildRequestContext();
      // Intentionally do NOT set 'searchBudget'.

      const result = await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('context_error');
      if (result.result !== 'ok') {
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
      }
      expect(delegateSpy).not.toHaveBeenCalled();
    });
  });

  describe('never throws', () => {
    it("converts an (unexpected) delegate rejection into result: 'error' instead of throwing", async () => {
      const requestContext = buildRequestContext();
      const budget = buildBudget(5);
      requestContext.set('searchBudget', budget);
      delegateSpy.mockRejectedValue(new Error('delegate exploded'));

      // Must resolve with a value — the tool layer never throws (design
      // Error Handling), so the agent loop can recover via retry or wrap-up.
      await expect(
        invokeExecute({ query: 'boom', limit: 5 }, requestContext),
      ).resolves.toMatchObject({ result: 'error' });

      // The attempt was made, so budget consumption stands.
      expect(budget.used).toBe(1);
      expect(budget.queries).toEqual(['boom']);
    });
  });

  describe('input schema identity with fullTextSearchTool', () => {
    it('shares the exact same input schema instance as the wrapped tool', () => {
      // Design constraint: the wrapper's input schema is IDENTICAL to the
      // original tool's (query / limit / sort / order). Reference identity
      // guarantees the wrapper auto-tracks any future schema change.
      expect(limitedSearchTool.inputSchema).toBe(
        fullTextSearchTool.inputSchema,
      );
    });

    it('rejects an empty query at the zod boundary without consuming budget or delegating', async () => {
      const requestContext = buildRequestContext();
      const budget = buildBudget(5);
      requestContext.set('searchBudget', budget);

      // Mastra wraps execute with validateToolInput. An empty `query`
      // violates the original schema's min(1) rule, so the wrapper returns a
      // ValidationError envelope without invoking the execute body.
      const result = await invokeExecute(
        { query: '', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(true);
      if (isValidationFailure(result)) {
        expect(result.validationErrors).toBeDefined();
      }
      expect(delegateSpy).not.toHaveBeenCalled();
      expect(budget.used).toBe(0);
      expect(budget.queries).toEqual([]);
    });
  });
});
