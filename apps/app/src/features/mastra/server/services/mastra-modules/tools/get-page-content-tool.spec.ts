import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MastraRequestContextShape } from '../types/request-context';
import { getPageContentTool } from './get-page-content-tool';

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

// The tool resolves the Page model via `mongoose.model('Page')`. Hoist mock fns
// so they are available inside the `vi.mock('mongoose', ...)` factory.
const mocks = vi.hoisted(() => ({
  findByIdAndViewer: vi.fn(),
  findByPathAndViewer: vi.fn(),
  populateDataToShowRevision: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: {
    model: (name: string) => {
      if (name === 'Page') {
        return {
          findByIdAndViewer: mocks.findByIdAndViewer,
          findByPathAndViewer: mocks.findByPathAndViewer,
        };
      }
      throw new Error(`unexpected model requested in spec: ${name}`);
    },
  },
}));

vi.mock('~/server/models/obsolete-page', () => ({
  populateDataToShowRevision: mocks.populateDataToShowRevision,
}));

// Helper to construct a typed RequestContext used by the tool.
const buildRequestContext = (): RequestContext<MastraRequestContextShape> =>
  new RequestContext<MastraRequestContextShape>();

// Minimal IUserHasId-shaped object. The tool MUST pass this by reference into
// findByIdAndViewer / findByPathAndViewer — no synthetic user reconstruction.
// The single cast inside this builder is the ONLY boundary where we admit
// that the test fixture isn't a full Mongoose document — every call site
// stays cast-free.
const buildMockUser = (): IUserHasId =>
  ({
    _id: 'user1',
    name: 'test-user',
    username: 'test-user',
  }) as unknown as IUserHasId;

// Build a page-like object that supports the .populate path indirectly used
// by populateDataToShowRevision. The .populate field is unused here because
// we mock populateDataToShowRevision itself, but a .populate spy provides
// defense-in-depth in case the tool changes to call .populate directly.
type MockPage = {
  path: string;
  updatedAt: Date;
  revision: unknown;
  populate: ReturnType<typeof vi.fn>;
};

const buildMockPage = (overrides: Partial<MockPage> = {}): MockPage => ({
  path: '/p1',
  updatedAt: new Date('2026-01-15T10:00:00Z'),
  revision: 'revision-id-placeholder',
  populate: vi.fn(),
  ...overrides,
});

// Discriminated union mirroring the tool's outputSchema. Defined locally so
// callers can read `result.result === 'ok'` and access `.page` / `.reason`
// without per-call narrowing casts.
type GetPageContentToolResult =
  | {
      result: 'ok';
      page: { path: string; body: string; updatedAt: string };
    }
  | {
      result: 'not_found_or_forbidden' | 'missing_input' | 'context_error';
      reason: string;
    };

// Mastra's validateToolInput wrapper returns this envelope shape (not the
// discriminated union) when zod input validation fails.
type ValidationFailure = { error: true; validationErrors: unknown };

// Invoke the tool's execute. The mastra runtime calls execute with
// `(inputData, { requestContext, ... })`, so tests mirror that shape.
const invokeExecute = async (
  inputData: { pageId?: string; pagePath?: string } | Record<string, never>,
  requestContext: RequestContext<MastraRequestContextShape>,
): Promise<GetPageContentToolResult | ValidationFailure> => {
  // The Mastra runtime's `execute` signature is intentionally loose
  // (`unknown` input / output), so a single `as never` per arg is unavoidable
  // here. Narrow the return shape ONCE so callers don't repeat the cast.
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await getPageContentTool.execute!(
    inputData as never,
    { requestContext } as never,
  );
  return result as GetPageContentToolResult | ValidationFailure;
};

// Type-guard to discriminate the validation envelope from the success/error
// discriminated union without a cast at the call site.
const isValidationFailure = (
  r: GetPageContentToolResult | ValidationFailure,
): r is ValidationFailure => 'error' in r && r.error === true;

describe('getPageContentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: populate just resolves with the page object unchanged. Tests
    // that exercise success override this to mutate page.revision.
    mocks.populateDataToShowRevision.mockImplementation(
      async (page: unknown) => page,
    );
  });

  describe('input validation (zod refine)', () => {
    it('rejects an empty input ({}) before reaching execute body', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);

      // Mastra wraps execute with validateToolInput. An empty input object
      // violates the zod `.refine` rule, so the wrapper returns a
      // ValidationError-shaped object without ever invoking the user-provided
      // execute body (mirrors fullTextSearchTool's empty-query test).
      const result = await invokeExecute({}, requestContext);

      expect(result).toBeDefined();
      expect(isValidationFailure(result)).toBe(true);
      if (isValidationFailure(result)) {
        expect(result.validationErrors).toBeDefined();
      }
      // The execute body never ran, so neither Mongoose accessor was called.
      expect(mocks.findByIdAndViewer).not.toHaveBeenCalled();
      expect(mocks.findByPathAndViewer).not.toHaveBeenCalled();
    });
  });

  describe('context guards', () => {
    it('returns context_error when user is missing from requestContext', async () => {
      const requestContext = buildRequestContext();
      // Intentionally do NOT set 'user'.

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('context_error');
      if (result.result !== 'ok') {
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
      }
      // No DB calls when context is invalid.
      expect(mocks.findByIdAndViewer).not.toHaveBeenCalled();
      expect(mocks.findByPathAndViewer).not.toHaveBeenCalled();
    });
  });

  describe('not_found_or_forbidden', () => {
    it('returns not_found_or_forbidden when findByIdAndViewer resolves null (pageId path)', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      mocks.findByIdAndViewer.mockResolvedValue(null);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('not_found_or_forbidden');
      // Routing assertion — the path branch must not be touched when
      // pageId is supplied.
      expect(mocks.findByPathAndViewer).not.toHaveBeenCalled();
    });

    it('returns not_found_or_forbidden when findByPathAndViewer resolves null (pagePath path)', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      mocks.findByPathAndViewer.mockResolvedValue(null);

      const result = await invokeExecute(
        { pagePath: '/some/path' },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('not_found_or_forbidden');
      // Routing assertion — the id branch must not be touched when
      // pagePath is supplied.
      expect(mocks.findByIdAndViewer).not.toHaveBeenCalled();
      // Argument shape — see page.ts:144-150 single-document overload.
      // useFindOne=true and null userGroups triggers internal auto-resolution.
      expect(mocks.findByPathAndViewer.mock.calls[0]).toEqual([
        '/some/path',
        mockUser,
        null,
        true,
      ]);
    });
  });

  describe('success path', () => {
    it('returns ok with body unmodified when pageId resolves a page', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockPage = buildMockPage({
        path: '/p1',
        updatedAt: new Date('2026-01-15T10:00:00Z'),
      });
      requestContext.set('user', mockUser);
      mocks.findByIdAndViewer.mockResolvedValue(mockPage);
      // Mutate page.revision the same way populateDataToShowRevision would,
      // so the tool's body extraction reads the populated revision object.
      mocks.populateDataToShowRevision.mockImplementation(
        async (page: MockPage) => {
          page.revision = { body: 'HELLO **WORLD**' };
          return page;
        },
      );

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      expect(result.page.path).toBe('/p1');
      // Byte-for-byte equality — the tool MUST NOT transform / re-escape the
      // Markdown body (requirement 2.5).
      expect(result.page.body).toBe('HELLO **WORLD**');
      expect(result.page.updatedAt).toBe('2026-01-15T10:00:00.000Z');
      // Routing — pagePath branch was not touched.
      expect(mocks.findByPathAndViewer).not.toHaveBeenCalled();
    });

    it('returns ok with body unmodified when pagePath resolves a page', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockPage = buildMockPage({
        path: '/p1',
        updatedAt: new Date('2026-01-15T10:00:00Z'),
      });
      requestContext.set('user', mockUser);
      mocks.findByPathAndViewer.mockResolvedValue(mockPage);
      mocks.populateDataToShowRevision.mockImplementation(
        async (page: MockPage) => {
          page.revision = { body: 'HELLO **WORLD**' };
          return page;
        },
      );

      const result = await invokeExecute({ pagePath: '/p1' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      expect(result.page.path).toBe('/p1');
      expect(result.page.body).toBe('HELLO **WORLD**');
      expect(result.page.updatedAt).toBe('2026-01-15T10:00:00.000Z');
      // Routing — pageId branch was not touched.
      expect(mocks.findByIdAndViewer).not.toHaveBeenCalled();
    });
  });

  describe('user reference identity (requirement 2.7 / 3.2 regression guard)', () => {
    it("passes the exact mockUser reference (===) to findByIdAndViewer's 2nd argument", async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      mocks.findByIdAndViewer.mockResolvedValue(null);

      await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(mocks.findByIdAndViewer).toHaveBeenCalledTimes(1);
      // Strict reference equality — the tool must NOT clone, rebuild from
      // _id, or otherwise synthesise a new user object.
      expect(mocks.findByIdAndViewer.mock.calls[0][1]).toBe(mockUser);
    });

    it("passes the exact mockUser reference (===) to findByPathAndViewer's 2nd argument", async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      mocks.findByPathAndViewer.mockResolvedValue(null);

      await invokeExecute({ pagePath: '/p1' }, requestContext);

      expect(mocks.findByPathAndViewer).toHaveBeenCalledTimes(1);
      expect(mocks.findByPathAndViewer.mock.calls[0][1]).toBe(mockUser);
    });
  });

  describe('exception handling', () => {
    it('converts thrown errors into not_found_or_forbidden without throwing out of execute', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      mocks.findByIdAndViewer.mockRejectedValue(new Error('boom'));

      // Must NOT throw — the agent loop must keep running on Mongoose errors.
      await expect(
        invokeExecute({ pageId: 'abc' }, requestContext),
      ).resolves.toMatchObject({ result: 'not_found_or_forbidden' });

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);
      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('not_found_or_forbidden');
      // The catch branch propagates the Error.message into reason when
      // available, otherwise falls back to 'fetch_failed'.
      if (result.result !== 'ok') {
        expect(typeof result.reason).toBe('string');
        const reason = result.reason;
        expect(reason === 'boom' || reason === 'fetch_failed').toBe(true);
      }
    });
  });
});
