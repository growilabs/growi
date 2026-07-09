import { mastra } from '~/features/mastra/server/services/mastra-modules';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { PathSuggestion } from '../../../interfaces/suggest-path-types';
import type { AgenticEngineOutput } from './agentic-output-schema';
import {
  AGENTIC_OUTPUT_JSON_SCHEMA,
  isAgenticEngineOutput,
} from './agentic-output-schema';
import { resolveAgentProviderOptions } from './agentic-provider-options';
import { buildAgenticRequestContext } from './agentic-request-context';
import { mapOutputToSuggestions } from './agentic-suggestion-mapper';
import type { StopReason } from './agentic-trace-log';
import { emitAgenticTraceLogs } from './agentic-trace-log';
import type { SuggestPathEngine } from './engine-types';

const logger = loggerFactory('growi:ai-tools:suggest-path:agentic-engine');

/**
 * Loosely-typed view of the generate result for trace reconstruction: the
 * steps / totalUsage shapes are runtime-observed (research.md "Spike
 * Results" item 4) and the trace helpers consume them as `unknown`, so the
 * engine does not depend on Mastra's generate return generics here.
 */
type GenerateResultView = {
  readonly object?: unknown;
  readonly steps?: unknown;
  readonly totalUsage?: unknown;
};

/**
 * Step ceiling as a secondary defense against loop runaway (the budgets and
 * the timeout are the primary controls): each search and each listChildren
 * call can cost up to 2 steps (tool call + follow-up reasoning), and
 * getPageContent reads — which are deliberately not budgeted (light Mongo
 * reads) — get the same 2-step allowance as searches, since the agent reads
 * at most one page per search hit it wants to verify. +4 covers
 * classification and final shaping (design.md call contract).
 */
const computeMaxSteps = (
  searchLimit: number,
  childListingLimit: number,
): number => 2 * searchLimit + 2 * childListingLimit + 2 * searchLimit + 4;

const buildUserPrompt = (body: string): string => {
  // The body is passed through untrimmed: the handling of very long bodies
  // (validator allows up to 100k chars) is an open design question deferred
  // to the verification phase, to be settled with A/B token measurements.
  return [
    'Propose suitable parent directory paths for saving the following document.',
    '',
    body,
  ].join('\n');
};

/**
 * Agentic engine: runs the suggestPathAgent from the Mastra registry with a
 * per-request search budget, validates the structured output, and maps it to
 * API suggestions (design.md "AgenticEngine").
 *
 * Failure contract (Requirement 4.5): structured-output validation failure,
 * agent/provider exceptions, and timeouts all reject — the orchestrator
 * catches the rejection and falls back to the memo-only response. Every
 * path, including the reject ones, emits one info summary line before
 * settling (design.md "AgenticEngine > State Management"; Requirements 2.4,
 * 6.2, 6.3).
 *
 * Requirement 5.5: this engine must not import any of the oneshot-specific
 * services (analyze-content / retrieve-search-candidates /
 * evaluate-candidates / generate-category-suggestion).
 */
export const agenticEngine: SuggestPathEngine = async (
  input,
): Promise<PathSuggestion[]> => {
  const { user, body, searchService } = input;
  const startedAt = Date.now();

  // Operational settings are read per request so a config change takes
  // effect without a server restart (Requirement 3.3).
  const searchLimit = configManager.getConfig(
    'aiTools:suggestPathAgenticSearchLimit',
  );
  const childListingLimit = configManager.getConfig(
    'aiTools:suggestPathAgenticChildListingLimit',
  );
  const timeoutMs = configManager.getConfig(
    'aiTools:suggestPathAgenticTimeoutMs',
  );

  const { requestContext, searchBudget, childListingBudget } =
    buildAgenticRequestContext(user, searchService, {
      searchLimit,
      childListingLimit,
    });

  // Registry retrieval (NOT a direct Agent import): keeps platform
  // configuration consistent and mirrors the chat-side handler pattern.
  const agent = mastra.getAgent('suggestPathAgent');

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort(
      new Error(`agentic engine timed out after ${timeoutMs}ms`),
    );
  }, timeoutMs);

  // Observability state shared between the success and reject paths: the
  // trace emitter receives whatever is known at emission time, so a reject
  // after validation still reports the classified informationType while an
  // earlier reject reports explicit nulls.
  let result: GenerateResultView | undefined;
  let informationType: AgenticEngineOutput['informationType'] | null = null;
  let suggestionCount = 0;

  const emitTrace = (stopReason: StopReason): void =>
    emitAgenticTraceLogs(logger, stopReason, {
      startedAt,
      searchBudget,
      childListingBudget,
      result,
      informationType,
      suggestionCount,
    });

  try {
    // Inline wrapper so the timer is ALWAYS cleared once generate settles
    // (success or failure), while `result` stays in scope for the mapping
    // and the trace emission below.
    result = await (async () => {
      try {
        return await agent.generate(buildUserPrompt(body), {
          structuredOutput: { schema: AGENTIC_OUTPUT_JSON_SCHEMA },
          maxSteps: computeMaxSteps(searchLimit, childListingLimit),
          abortSignal: controller.signal,
          requestContext,
          providerOptions: resolveAgentProviderOptions(),
        });
      } finally {
        clearTimeout(timeoutTimer);
      }
    })();

    // Defense in depth (output-mapping rule 1): Mastra's structuring pass
    // already enforces the JSON Schema, but the engine re-validates before
    // trusting the shape.
    const output: unknown = result.object;
    if (!isAgenticEngineOutput(output)) {
      throw new Error(
        'agentic engine returned an output that failed structured-output validation',
      );
    }
    informationType = output.informationType;

    const suggestions = await mapOutputToSuggestions(output);
    suggestionCount = suggestions.length;

    // stopReason rules (design.md): budget_exhausted = normal completion
    // with the search budget fully used; completed = any other normal run.
    emitTrace(
      searchBudget.used >= searchBudget.limit
        ? 'budget_exhausted'
        : 'completed',
    );
    return suggestions;
  } catch (err) {
    // Reject paths emit the summary BEFORE rethrowing (Requirement 4.5
    // keeps the rejection contract intact). Timeout detection is tied to
    // the engine's own AbortController state — not to error-message
    // parsing — so provider-side abort wrapping cannot misclassify it.
    emitTrace(controller.signal.aborted ? 'timeout' : 'error');
    throw err;
  }
};
