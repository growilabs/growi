import type { PathSuggestion } from '../../../interfaces/suggest-path-types';
import { SuggestPathEngineId } from '../../../interfaces/suggest-path-types';
import { agenticEngine } from './agentic-engine';
import type { SuggestPathEngine, SuggestPathEngineInput } from './engine-types';
import { oneshotEngine } from './oneshot-engine';

// Static map only — no registry or extension mechanism by design.
// `satisfies` enforces compile-time completeness over SuggestPathEngineId.
const engines = {
  [SuggestPathEngineId.ONESHOT]: oneshotEngine,
  [SuggestPathEngineId.AGENTIC]: agenticEngine,
} satisfies Record<SuggestPathEngineId, SuggestPathEngine>;

/**
 * Resolve the engine implementation for the given engine id and run it.
 *
 * Pure routing: the input and the result pass through unaltered, and engine
 * rejections propagate to the caller (fallback is the orchestrator's job).
 */
export const runEngine = (
  engineId: SuggestPathEngineId,
  input: SuggestPathEngineInput,
): Promise<PathSuggestion[]> => {
  return engines[engineId](input);
};
