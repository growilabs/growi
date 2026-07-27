import type { CustomUIMessage } from '~/features/mastra/interfaces/chat-message';

import { extractPageSources } from './page-sources';

type Part = CustomUIMessage['parts'][number];

// The chat message is typed, but building an exactly-typed tool-part literal
// for a fixture costs far more than it saves (the AI SDK tool-part union is
// large), so we assert the minimal shape the helper reads. `output` is `unknown`
// here on purpose so a fixture can also simulate out-of-contract / legacy data
// (Type-Safe Mocking tolerance: no convenient constructor for this union).
const getPageContentPart = (output: unknown): Part =>
  ({
    type: 'tool-getPageContentTool',
    toolCallId: 'call-1',
    state: 'output-available',
    input: {},
    output,
  }) as unknown as Part;

const fullTextSearchPart = (output: unknown): Part =>
  ({
    type: 'tool-fullTextSearchTool',
    toolCallId: 'call-2',
    state: 'output-available',
    input: {},
    output,
  }) as unknown as Part;

const getPageContentInProgressPart = (): Part =>
  ({
    type: 'tool-getPageContentTool',
    toolCallId: 'call-3',
    state: 'input-available',
    input: {},
  }) as unknown as Part;

const okPagePart = (pageId: string, path: string): Part =>
  getPageContentPart({ result: 'ok', page: { pageId, path, totalLines: 10 } });

const textPart = (text: string): Part => ({ type: 'text', text });
const reasoningPart = (text: string): Part => ({ type: 'reasoning', text });

describe('extractPageSources', () => {
  it('returns one source per page the assistant opened, in order', () => {
    const parts: Part[] = [
      textPart('Here is the answer'),
      okPagePart('p1', '/Sandbox/Alpha'),
      okPagePart('p2', '/Docs/Beta'),
    ];

    expect(extractPageSources(parts)).toStrictEqual([
      { pageId: 'p1', path: '/Sandbox/Alpha' },
      { pageId: 'p2', path: '/Docs/Beta' },
    ]);
  });

  it('deduplicates repeated fetches of the same page by pageId', () => {
    // The agent commonly calls getPageContent twice for one page: an outline
    // call, then a section drill-down with `offset`.
    const parts: Part[] = [
      okPagePart('p1', '/Sandbox/Alpha'),
      okPagePart('p1', '/Sandbox/Alpha'),
    ];

    expect(extractPageSources(parts)).toStrictEqual([
      { pageId: 'p1', path: '/Sandbox/Alpha' },
    ]);
  });

  it('ignores failed getPageContent results', () => {
    const parts: Part[] = [
      getPageContentPart({
        result: 'not_found_or_forbidden',
        reason: 'denied',
      }),
    ];

    expect(extractPageSources(parts)).toStrictEqual([]);
  });

  it('ignores full-text-search tool parts (excluded by part type)', () => {
    const parts: Part[] = [
      fullTextSearchPart({
        result: 'ok',
        hits: [{ pageId: 'p1', pagePath: '/x' }],
        totalCount: 1,
      }),
    ];

    expect(extractPageSources(parts)).toStrictEqual([]);
  });

  it('ignores tool calls that have not produced output yet', () => {
    expect(extractPageSources([getPageContentInProgressPart()])).toStrictEqual(
      [],
    );
  });

  it('ignores ok page outputs that predate the pageId field (legacy threads)', () => {
    // A thread persisted before pageId was added: at runtime the page object
    // has no pageId, so it cannot become a (permalink) source. Graceful
    // degradation — the old thread simply shows no sources.
    const parts: Part[] = [
      getPageContentPart({
        result: 'ok',
        page: { path: '/legacy', totalLines: 5 },
      }),
    ];

    expect(extractPageSources(parts)).toStrictEqual([]);
  });

  it('ignores non-tool parts', () => {
    const parts: Part[] = [textPart('hello'), reasoningPart('thinking')];

    expect(extractPageSources(parts)).toStrictEqual([]);
  });

  it('returns an empty list when there are no parts', () => {
    expect(extractPageSources([])).toStrictEqual([]);
  });
});
