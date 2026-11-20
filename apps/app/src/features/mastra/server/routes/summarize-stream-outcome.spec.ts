import {
  INITIAL_RELAY_STATE,
  isCompleteSummary,
  type SummaryRelayState,
  trackSummaryChunk,
} from './summarize-stream-outcome';

const replay = (
  chunks: { type: string; delta?: string }[],
): SummaryRelayState => chunks.reduce(trackSummaryChunk, INITIAL_RELAY_STATE);

describe('trackSummaryChunk', () => {
  it('records text written in the current step', () => {
    expect(replay([{ type: 'text-delta', delta: 'Summary' }]).hasText).toBe(
      true,
    );
  });

  it('ignores whitespace-only text', () => {
    expect(replay([{ type: 'text-delta', delta: ' \n' }]).hasText).toBe(false);
  });

  it('forgets text from an earlier step when a new step starts', () => {
    const state = replay([
      { type: 'start-step' },
      { type: 'text-delta', delta: 'Reading the page.' },
      { type: 'start-step' },
    ]);

    expect(state.hasText).toBe(false);
  });

  it('remembers an error chunk for the rest of the stream', () => {
    const state = replay([
      { type: 'error' },
      { type: 'start-step' },
      { type: 'text-delta', delta: 'late' },
    ]);

    expect(state.hasErrorChunk).toBe(true);
  });
});

describe('isCompleteSummary', () => {
  const withText: SummaryRelayState = { hasErrorChunk: false, hasText: true };

  it('accepts a stop whose final step wrote text', () => {
    expect(isCompleteSummary('stop', withText)).toBe(true);
  });

  it.each([
    'tool-calls',
    'length',
    'error',
    undefined,
  ])('rejects finish reason %s', (finishReason) => {
    expect(isCompleteSummary(finishReason, withText)).toBe(false);
  });

  it('rejects a stop without text', () => {
    expect(isCompleteSummary('stop', INITIAL_RELAY_STATE)).toBe(false);
  });
});
