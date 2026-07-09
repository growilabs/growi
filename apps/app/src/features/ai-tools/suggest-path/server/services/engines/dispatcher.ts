import { SuggestPathEngineId } from '../../../interfaces/suggest-path-types';
import { agenticEngine } from './agentic-engine';
import type { SuggestPathEngineRecord } from './engine-types';
import { oneshotEngine } from './oneshot-engine';

// Static map only — no registry or extension mechanism by design.
// `satisfies` enforces compile-time completeness over SuggestPathEngineId.
//
// Each record declares its own fallback semantics (degradeToMemoOnFailure),
// so the orchestrator applies the policy generically instead of branching on
// engine ids (coding-style: no hard-coded mode/variant checks in consumers).
const engines = {
  // Pre-existing contract (Requirement 5.3): oneshot rejections propagate to
  // the route (HTTP 500).
  [SuggestPathEngineId.ONESHOT]: {
    run: oneshotEngine,
    degradeToMemoOnFailure: false,
  },
  // Requirement 4.5: agentic rejections degrade to the memo-only response.
  [SuggestPathEngineId.AGENTIC]: {
    run: agenticEngine,
    degradeToMemoOnFailure: true,
  },
} satisfies Record<SuggestPathEngineId, SuggestPathEngineRecord>;

const isKnownEngineId = (engineId: string): engineId is SuggestPathEngineId =>
  Object.hasOwn(engines, engineId);

/**
 * Resolve the engine record for the given engine id.
 *
 * Accepts an arbitrary string because the configured default engine id is an
 * env-sourced value the config layer does not runtime-validate: an operator
 * typo (e.g. 'onshot') must resolve to undefined here so the orchestrator can
 * degrade to the guaranteed memo-only response, instead of crashing every
 * request with an HTTP 500 on an `undefined(input)` call.
 */
export const getEngineRecord = (
  engineId: string,
): SuggestPathEngineRecord | undefined =>
  isKnownEngineId(engineId) ? engines[engineId] : undefined;
