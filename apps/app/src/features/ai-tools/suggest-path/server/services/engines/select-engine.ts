import { isAiConfigured } from '~/features/mastra/server/services/is-ai-configured';

import type { SearchService } from '../../../interfaces/suggest-path-types';
import { agenticEngine } from './agentic-engine';
import type { SuggestPathEngineRecord } from './engine-types';
import { oneshotEngine } from './oneshot-engine';

// Each record declares its own fallback semantics (degradeToMemoOnFailure),
// so the orchestrator applies the policy generically instead of branching on
// engine ids (coding-style: no hard-coded mode/variant checks in consumers).

// Requirement 4.5: agentic rejections degrade to the memo-only response.
const agenticRecord: SuggestPathEngineRecord = {
  id: 'agentic',
  run: agenticEngine,
  degradeToMemoOnFailure: true,
};

// Pre-existing contract (Requirement 5.2): oneshot rejections propagate to
// the route (HTTP 500).
const oneshotRecord: SuggestPathEngineRecord = {
  id: 'oneshot',
  run: oneshotEngine,
  degradeToMemoOnFailure: false,
};

/**
 * Select the engine by runtime availability (Requirement 5) — there is no
 * operator-facing engine switch:
 *
 * 1. The Mastra AI stack has at least one available model -> agentic
 * 2. Otherwise, full-text search is reachable -> oneshot
 * 3. Neither -> undefined (the orchestrator degrades to the guaranteed
 *    memo-only response)
 *
 * The agentic engine is not additionally gated on search reachability: its
 * search tool degrades inside the run, and an engine-level failure is
 * absorbed by the memo fallback (Requirement 4.5).
 *
 * Availability is evaluated per request so configuration changes (AI
 * settings, search connectivity) take effect without a server restart.
 */
export const selectEngine = (
  searchService: SearchService,
): SuggestPathEngineRecord | undefined => {
  if (isAiConfigured()) {
    return agenticRecord;
  }
  if (searchService.isReachable) {
    return oneshotRecord;
  }
  return undefined;
};
