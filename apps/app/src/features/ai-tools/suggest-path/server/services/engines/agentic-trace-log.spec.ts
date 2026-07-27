import {
  extractSearchHitSummaries,
  extractToolCallRecords,
  pickTokenUsage,
} from './agentic-trace-log';

// Runtime chunk shapes as observed on @mastra/core 1.41.0 (research.md
// "Spike Results" item 4).
const toolCallChunk = (toolName: string, args: unknown): unknown => ({
  type: 'tool-call',
  runId: 'run-1',
  from: 'AGENT',
  payload: { toolCallId: 'call-1', toolName, args },
});

const toolResultChunk = (toolName: string, result: unknown): unknown => ({
  type: 'tool-result',
  runId: 'run-1',
  from: 'AGENT',
  payload: { toolCallId: 'call-1', toolName, result },
});

describe('extractToolCallRecords', () => {
  it('reconstructs the tool-call sequence across steps in order', () => {
    const steps = [
      {
        toolCalls: [
          toolCallChunk('fullTextSearch', { query: 'first' }),
          toolCallChunk('fullTextSearch', { query: 'second' }),
        ],
      },
      { toolCalls: [toolCallChunk('getPageContent', { pageId: 'p1' })] },
    ];

    expect(extractToolCallRecords(steps)).toEqual([
      { toolName: 'fullTextSearch', args: { query: 'first' } },
      { toolName: 'fullTextSearch', args: { query: 'second' } },
      { toolName: 'getPageContent', args: { pageId: 'p1' } },
    ]);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'garbage'],
    ['a number', 42],
    ['an object', { toolCalls: [] }],
  ])('returns an empty array when steps is %s (not an array)', (_label, steps) => {
    expect(extractToolCallRecords(steps)).toEqual([]);
  });

  it('skips malformed steps and chunks instead of throwing', () => {
    const steps = [
      null,
      'not-a-step',
      { toolCalls: 'not-an-array' },
      {
        toolCalls: [
          null,
          { payload: null },
          { payload: { args: { query: 'no toolName' } } },
          { payload: { toolName: 42, args: {} } },
          toolCallChunk('fullTextSearch', { query: 'valid' }),
        ],
      },
    ];

    expect(extractToolCallRecords(steps)).toEqual([
      { toolName: 'fullTextSearch', args: { query: 'valid' } },
    ]);
  });
});

describe('extractSearchHitSummaries', () => {
  it('summarizes each fullTextSearch result as kind + totalCount + hit paths, dropping snippets', () => {
    const steps = [
      {
        toolResults: [
          toolResultChunk('fullTextSearch', {
            result: 'ok',
            hits: [
              { pageId: 'p1', pagePath: '/a/hit-1', snippet: 'body excerpt' },
              { pageId: 'p2', pagePath: '/a/hit-2' },
            ],
            totalCount: 12,
          }),
          toolResultChunk('fullTextSearch', {
            result: 'limit_exceeded',
            reason: 'budget exhausted',
          }),
        ],
      },
    ];

    expect(extractSearchHitSummaries(steps)).toEqual([
      { resultKind: 'ok', totalCount: 12, hitPaths: ['/a/hit-1', '/a/hit-2'] },
      { resultKind: 'limit_exceeded', totalCount: null, hitPaths: [] },
    ]);
  });

  it('excludes results of other tools (getPageContent bodies never enter the trace)', () => {
    const steps = [
      {
        toolResults: [
          toolResultChunk('getPageContent', { body: 'full page body' }),
        ],
      },
    ];

    expect(extractSearchHitSummaries(steps)).toEqual([]);
  });

  it('falls back to an "unknown" summary for a malformed search result', () => {
    const steps = [
      {
        toolResults: [
          toolResultChunk('fullTextSearch', 'not-an-object'),
          toolResultChunk('fullTextSearch', {
            result: 99, // kind is not a string
            totalCount: 'many', // not a number
            hits: [{ pagePath: 123 }, null], // paths not strings
          }),
        ],
      },
    ];

    expect(extractSearchHitSummaries(steps)).toEqual([
      { resultKind: 'unknown', totalCount: null, hitPaths: [] },
      { resultKind: 'unknown', totalCount: null, hitPaths: [] },
    ]);
  });

  it('returns an empty array when steps is missing or malformed', () => {
    expect(extractSearchHitSummaries(undefined)).toEqual([]);
    expect(extractSearchHitSummaries('garbage')).toEqual([]);
    expect(
      extractSearchHitSummaries([{ toolResults: 'not-an-array' }]),
    ).toEqual([]);
  });
});

describe('pickTokenUsage', () => {
  it('picks the AI SDK v5 token fields and ignores extra fields (raw, reasoningTokens, ...)', () => {
    expect(
      pickTokenUsage({
        inputTokens: 1183,
        outputTokens: 232,
        totalTokens: 1415,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        raw: { provider: 'specific' },
      }),
    ).toEqual({ inputTokens: 1183, outputTokens: 232, totalTokens: 1415 });
  });

  it('returns null when totalUsage is missing or not an object', () => {
    expect(pickTokenUsage(undefined)).toBeNull();
    expect(pickTokenUsage(null)).toBeNull();
    expect(pickTokenUsage(7)).toBeNull();
    expect(pickTokenUsage('1415 tokens')).toBeNull();
  });

  it('nulls out individual fields that are not numbers (keeps one consistent shape)', () => {
    expect(pickTokenUsage({ inputTokens: 100 })).toEqual({
      inputTokens: 100,
      outputTokens: null,
      totalTokens: null,
    });
    expect(
      pickTokenUsage({
        inputTokens: '100',
        outputTokens: 50,
        totalTokens: 150,
      }),
    ).toEqual({ inputTokens: null, outputTokens: 50, totalTokens: 150 });
  });
});
