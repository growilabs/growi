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
// `updatedAt` is optional so we can simulate legacy pages predating the
// timestamps schema (PR #11204 review FB: tool must not crash when null).
type MockPage = {
  _id: string;
  path: string;
  updatedAt?: Date;
  revision: unknown;
  populate: ReturnType<typeof vi.fn>;
};

const buildMockPage = (overrides: Partial<MockPage> = {}): MockPage => ({
  _id: 'page-1-id',
  path: '/p1',
  updatedAt: new Date('2026-01-15T10:00:00Z'),
  revision: 'revision-id-placeholder',
  populate: vi.fn(),
  ...overrides,
});

// Convenience builder: wire findByIdAndViewer to return a mockPage and have
// populateDataToShowRevision attach { body } onto it. Centralising this
// removes duplicated mockImplementation boilerplate from each success case.
const setupPageWithBody = (body: string, viaPath = false): MockPage => {
  const mockPage = buildMockPage();
  if (viaPath) {
    mocks.findByPathAndViewer.mockResolvedValue(mockPage);
  } else {
    mocks.findByIdAndViewer.mockResolvedValue(mockPage);
  }
  mocks.populateDataToShowRevision.mockImplementation(
    async (page: MockPage) => {
      page.revision = { body };
      return page;
    },
  );
  return mockPage;
};

// Outline entry shape mirroring the tool's outputSchema.
type OutlineEntry = {
  line: number;
  level: number;
  heading: string;
};

// Discriminated union mirroring the tool's outputSchema. Defined locally so
// callers can read `result.result === 'ok'` and access `.page` / `.reason`
// without per-call narrowing casts.
// Content fields are optional: omitted in "outline mode" (offset omitted on a
// long page) and present in "content mode" (offset provided) or under the
// small-page optimization. `outline` is present only on the first call.
type GetPageContentOkResult = {
  result: 'ok';
  page: {
    pageId: string;
    path: string;
    // Optional: legacy pages with `updatedAt == null` cause the tool to omit
    // the field entirely (PR #11204 review FB).
    updatedAt?: string;
    totalLines: number;
    content?: string;
    offset?: number;
    limit?: number;
    hasMore?: boolean;
    outline?: OutlineEntry[];
  };
};
type GetPageContentFailureResult = {
  result: 'not_found_or_forbidden' | 'missing_input' | 'context_error';
  reason: string;
};
type GetPageContentToolResult =
  | GetPageContentOkResult
  | GetPageContentFailureResult;

// Mastra's validateToolInput wrapper returns this envelope shape (not the
// discriminated union) when zod input validation fails.
type ValidationFailure = { error: true; validationErrors: unknown };

// Invoke the tool's execute. The mastra runtime calls execute with
// `(inputData, { requestContext, ... })`, so tests mirror that shape.
const invokeExecute = async (
  inputData:
    | {
        pageId?: string;
        pagePath?: string;
        offset?: number;
        limit?: number;
      }
    | Record<string, never>,
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

    it('rejects limit > 500 at zod boundary without invoking execute body', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);

      // zod's `.max(500)` should reject before the execute body runs.
      // This mirrors the empty-query test in full-text-search-tool.spec.ts.
      const result = await invokeExecute(
        { pageId: 'abc', limit: 501 },
        requestContext,
      );

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
    it('returns ok with content unmodified, defaults echoed, and outline auto-included when pageId resolves a page', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      // Two lines, one ATX heading on line 1 — exercises content equality,
      // totalLines, default offset / limit echo, hasMore=false, outline auto-include.
      const body = '# H1\nbody text';
      setupPageWithBody(body);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      expect(result.page.path).toBe('/p1');
      // pageId is surfaced for the client "sources" permalink (/{pageId}).
      expect(result.page.pageId).toBe('page-1-id');
      // Byte-for-byte equality — the tool MUST NOT transform / re-escape the
      // Markdown body (requirement 2.5).
      expect(result.page.content).toBe(body);
      expect(result.page.updatedAt).toBe('2026-01-15T10:00:00.000Z');
      // New required fields after Task 3.4: defaults are echoed back.
      expect(result.page.totalLines).toBe(2);
      expect(result.page.offset).toBe(1);
      expect(result.page.limit).toBe(200);
      expect(result.page.hasMore).toBe(false);
      // Outline auto-included since offset is omitted (= first call).
      expect(result.page.outline).toEqual([
        { line: 1, level: 1, heading: 'H1' },
      ]);
      // Routing — pagePath branch was not touched.
      expect(mocks.findByPathAndViewer).not.toHaveBeenCalled();
    });

    it('returns ok with content unmodified, defaults echoed, and outline auto-included when pagePath resolves a page', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      const body = '# H1\nbody text';
      setupPageWithBody(body, /* viaPath */ true);

      const result = await invokeExecute({ pagePath: '/p1' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      expect(result.page.path).toBe('/p1');
      expect(result.page.pageId).toBe('page-1-id');
      expect(result.page.content).toBe(body);
      expect(result.page.updatedAt).toBe('2026-01-15T10:00:00.000Z');
      expect(result.page.totalLines).toBe(2);
      expect(result.page.offset).toBe(1);
      expect(result.page.limit).toBe(200);
      expect(result.page.hasMore).toBe(false);
      expect(result.page.outline).toEqual([
        { line: 1, level: 1, heading: 'H1' },
      ]);
      // Routing — pageId branch was not touched.
      expect(mocks.findByIdAndViewer).not.toHaveBeenCalled();
    });
  });

  describe('legacy data — missing updatedAt (PR #11204 review FB)', () => {
    it('omits updatedAt from the response when page.updatedAt is null (must not crash)', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      requestContext.set('user', mockUser);
      // Simulate a legacy page predating the timestamps schema: the body
      // resolves normally but updatedAt is missing on the document. The tool
      // MUST NOT throw a TypeError on `.toISOString()` (the bug the FB flags)
      // and MUST omit the field from the response rather than emit a
      // bogus default — downstream agents already distinguish presence.
      const mockPage = buildMockPage({ updatedAt: undefined });
      mocks.findByIdAndViewer.mockResolvedValue(mockPage);
      mocks.populateDataToShowRevision.mockImplementation(
        async (page: MockPage) => {
          page.revision = { body: 'hello' };
          return page;
        },
      );

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      // Critical: `updatedAt` must be omitted from the payload (not the
      // string 'undefined', not an empty string). The output schema marks
      // it optional precisely for this case.
      expect('updatedAt' in result.page).toBe(false);
      expect(result.page.path).toBe('/p1');
      expect(result.page.content).toBe('hello');
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
      // Defensive: the failure branch must NOT expose any `page` field
      // (neither the old `body` nor the new `content` shape).
      if (result.result !== 'ok') {
        expect('page' in result).toBe(false);
      }
    });
  });

  describe('pagination — hasMore boundaries (requirement 2.10 / 2.11)', () => {
    it('returns hasMore=false when offset equals totalLines (final line included)', async () => {
      // Body with exactly 5 lines. offset=5 means we read the last line only.
      const body = 'L1\nL2\nL3\nL4\nL5';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute(
        { pageId: 'abc', offset: 5, limit: 200 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      expect(result.page.content).toBe('L5');
      expect(result.page.totalLines).toBe(5);
      expect(result.page.offset).toBe(5);
      expect(result.page.hasMore).toBe(false);
    });

    it('returns hasMore=false when offset === totalLines - limit + 1 (read-to-end in one call)', async () => {
      // 200 lines total. offset=101, limit=100 reads lines 101..200 inclusive.
      const lines = Array.from({ length: 200 }, (_, i) => `L${i + 1}`);
      const body = lines.join('\n');
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute(
        { pageId: 'abc', offset: 101, limit: 100 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      // content is always present in content mode (offset provided).
      const { content } = result.page;
      if (content == null) throw new Error('expected content');
      expect(content.split('\n')).toHaveLength(100);
      expect(content.split('\n')[0]).toBe('L101');
      expect(content.split('\n')[99]).toBe('L200');
      expect(result.page.totalLines).toBe(200);
      expect(result.page.hasMore).toBe(false);
    });

    it('returns content="" and hasMore=false when offset > totalLines (range out of bounds, not an error)', async () => {
      const body = 'L1\nL2\nL3\nL4\nL5';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute(
        { pageId: 'abc', offset: 100, limit: 200 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      // Requirement 2.11: out-of-bounds is NOT an error — it stays result: 'ok'.
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      expect(result.page.content).toBe('');
      expect(result.page.totalLines).toBe(5);
      expect(result.page.hasMore).toBe(false);
    });
  });

  describe('outline / content mode selection (requirement 2.8 / 2.9 / 2.10)', () => {
    it('outline mode: offset omitted on a LONG page (totalLines > limit) returns outline only, no content fields', async () => {
      // 250-line body with two ATX headings. Default limit is 200, so
      // totalLines (250) > limit → the first call returns the outline ONLY.
      const lines = Array.from({ length: 250 }, (_, i) => {
        const n = i + 1;
        if (n === 1) return '# H1';
        if (n === 100) return '## H2';
        return `L${n}`;
      });
      const body = lines.join('\n');
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      // totalLines is always present.
      expect(result.page.totalLines).toBe(250);
      // Outline is present (first call) and lists every heading in the body.
      expect(result.page.outline).toEqual([
        { line: 1, level: 1, heading: 'H1' },
        { line: 100, level: 2, heading: 'H2' },
      ]);
      // Content fields are OMITTED in outline mode — the agent must drill in
      // with an explicit `offset` to fetch a section.
      expect(result.page.content).toBeUndefined();
      expect(result.page.offset).toBeUndefined();
      expect(result.page.limit).toBeUndefined();
      expect(result.page.hasMore).toBeUndefined();
    });

    it('small-page optimization: offset omitted on a SHORT page (totalLines <= limit) returns outline AND content', async () => {
      const body = '# H1\n\n## H2\nbody';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      // Both outline and content are returned so the agent can answer in one
      // round-trip when the whole page fits in a single page.
      expect(result.page.outline).toEqual([
        { line: 1, level: 1, heading: 'H1' },
        { line: 3, level: 2, heading: 'H2' },
      ]);
      expect(result.page.content).toBe(body);
      expect(result.page.offset).toBe(1);
      expect(result.page.limit).toBe(200);
      expect(result.page.hasMore).toBe(false);
    });

    it('content mode: offset explicitly 1 returns content only, NO outline', async () => {
      // In the redesign `offset: 1` is content mode, not a first call. The
      // single rule is "omit offset to get the outline" — there is no
      // includeOutline flag and offset===1 is no longer treated as first call.
      const body = '# H1\n\n## H2\nbody';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute(
        { pageId: 'abc', offset: 1 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      expect(result.page.outline).toBeUndefined();
      expect(result.page.content).toBe(body);
      expect(result.page.offset).toBe(1);
    });

    it('content mode: offset > 1 returns content only, NO outline', async () => {
      const body = '# H1\nL2\nL3\nL4';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute(
        { pageId: 'abc', offset: 2 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      expect(result.page.outline).toBeUndefined();
      expect(result.page.content).toBe('L2\nL3\nL4');
    });
  });

  describe('outline extraction (requirement 2.9)', () => {
    it('excludes code-block / indented-code / HTML-block "headings" from outline', async () => {
      // Real heading + 3 false positives that the MDAST parser must reject:
      //  - fenced code block (``` ... ```)
      //  - indented code block (4-space indent)
      //  - HTML block (<pre>...</pre>)
      // front matter is intentionally NOT tested — see design.md L702.
      const body = [
        '# Real',
        '',
        '```',
        '# fake-heading-in-code',
        '```',
        '',
        '    # fake-indented-heading',
        '',
        '<pre># fake-html-heading</pre>',
      ].join('\n');
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      expect(result.page.outline).toEqual([
        { line: 1, level: 1, heading: 'Real' },
      ]);
    });

    it('strips Markdown decorations from heading text via mdast-util-to-string', async () => {
      const body = '## **Bold** [Link](url)';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      expect(result.page.outline).toEqual([
        { line: 1, level: 2, heading: 'Bold Link' },
      ]);
    });

    it('extracts Setext headings with `line` pointing to the text line (not the underline)', async () => {
      // Setext heading: text on its own line followed by an underline. The
      // CommonMark spec assigns `position.start.line` to the text line, so
      // an agent calling back with `offset: line` lands at the heading.
      const body = 'My H1\n=====\n\nMy H2\n-----';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      expect(result.page.outline).toEqual([
        { line: 1, level: 1, heading: 'My H1' },
        { line: 4, level: 2, heading: 'My H2' },
      ]);
    });

    it('returns outline=[] when the page has no headings', async () => {
      const body = 'just a paragraph\nanother line';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute({ pageId: 'abc' }, requestContext);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      // Auto-include rule fires (offset omitted), so `outline` is present
      // and an empty array — distinct from `undefined`.
      expect(result.page.outline).toEqual([]);
    });
  });

  describe('newline handling (requirement 2.5)', () => {
    it('splits CRLF-terminated pages correctly and preserves slicing semantics', async () => {
      // 5 lines separated by CRLF. The tool splits on /\r?\n/, so totalLines
      // must be 5 and `content` slicing must work the same as LF.
      const body = 'L1\r\nL2\r\nL3\r\nL4\r\nL5';
      const requestContext = buildRequestContext();
      requestContext.set('user', buildMockUser());
      setupPageWithBody(body);

      const result = await invokeExecute(
        { pageId: 'abc', offset: 2, limit: 2 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      if (result.result !== 'ok') throw new Error('expected ok');
      expect(result.page.totalLines).toBe(5);
      // The sliced output is joined by LF only — the tool deliberately
      // normalises line endings on the way out.
      expect(result.page.content).toBe('L2\nL3');
      expect(result.page.offset).toBe(2);
      expect(result.page.limit).toBe(2);
      expect(result.page.hasMore).toBe(true);
    });
  });
});
