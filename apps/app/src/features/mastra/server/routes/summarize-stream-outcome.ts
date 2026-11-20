export type SummaryRelayState = {
  readonly hasErrorChunk: boolean;
  // Text in the current step only: preamble from an earlier tool-calling
  // step is not a summary.
  readonly hasText: boolean;
};

export const INITIAL_RELAY_STATE: SummaryRelayState = {
  hasErrorChunk: false,
  hasText: false,
};

type RelayedChunk = { type: string; delta?: string };

export const trackSummaryChunk = (
  state: SummaryRelayState,
  chunk: RelayedChunk,
): SummaryRelayState => {
  switch (chunk.type) {
    case 'error':
      return { ...state, hasErrorChunk: true };
    case 'start-step':
      return { ...state, hasText: false };
    case 'text-delta':
      return chunk.delta != null && chunk.delta.trim() !== ''
        ? { ...state, hasText: true }
        : state;
    default:
      return state;
  }
};

// 'tool-calls' (maxSteps exhausted) and 'length' (truncated) end without a
// complete summary.
export const isCompleteSummary = (
  finishReason: string | undefined,
  state: SummaryRelayState,
): boolean => finishReason === 'stop' && state.hasText;
