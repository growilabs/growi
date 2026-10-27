import { isAiConfigured } from '~/features/mastra/server/services/is-ai-configured';

import { agenticEngine } from './agentic-engine';
import type { SuggestPathEngineRecord } from './engine-types';

// Each record declares its own fallback semantics (degradeToMemoOnFailure),
// so the orchestrator applies the policy generically instead of branching on
// engine ids (coding-style: no hard-coded mode/variant checks in consumers).

// Requirement 4.5: agentic rejections degrade to the memo-only response.
const agenticRecord: SuggestPathEngineRecord = {
  id: 'agentic',
  run: agenticEngine,
  degradeToMemoOnFailure: true,
};

/**
 * Select the engine by runtime availability — there is no operator-facing
 * engine switch:
 *
 * 1. The Mastra AI stack has at least one available model -> agentic
 * 2. Otherwise -> undefined (the orchestrator degrades to the guaranteed
 *    memo-only response)
 *
 * The legacy oneshot engine has been removed together with `features/openai`;
 * a future Elasticsearch-only (AI-free) fallback engine is planned to occupy
 * this second slot (see the roadmap in the suggest-path-agentic spec). The
 * record shape and the orchestrator's asymmetric-fallback policy are kept
 * generic so that engine can be added here without touching the orchestrator.
 *
 * Availability is evaluated per request so a configuration change takes
 * effect without a server restart.
 */
export const selectEngine = (): SuggestPathEngineRecord | undefined => {
  if (isAiConfigured()) {
    return agenticRecord;
  }
  return undefined;
};
