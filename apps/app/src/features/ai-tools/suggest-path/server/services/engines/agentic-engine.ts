import { RequestContext } from '@mastra/core/request-context';

import { mastra } from '~/features/mastra/server/services/mastra-modules';
import type { SuggestPathRequestContextShape } from '~/features/mastra/server/services/mastra-modules/agents/suggest-path';
import { configManager } from '~/server/service/config-manager';
import type SearchServiceImpl from '~/server/service/search';
import loggerFactory from '~/utils/logger';

import type { PathSuggestion } from '../../../interfaces/suggest-path-types';
import { SuggestionType } from '../../../interfaces/suggest-path-types';
import { resolveParentGrant } from '../resolve-parent-grant';
import type { AgenticEngineOutput } from './agentic-output-schema';
import {
  AGENTIC_OUTPUT_JSON_SCHEMA,
  isAgenticEngineOutput,
} from './agentic-output-schema';
import type { StopReason } from './agentic-trace-log';
import {
  extractSearchHitSummaries,
  extractToolCallRecords,
  GET_PAGE_CONTENT_TOOL_NAME,
  pickTokenUsage,
} from './agentic-trace-log';
import type { SuggestPathEngine } from './engine-types';

const logger = loggerFactory('growi:ai-tools:suggest-path:agentic-engine');

const SUGGESTION_CAP = 20;

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
 * Normalize a proposed path to a "/segment/.../" parent-directory form
 * (leading and trailing slash guaranteed). Returns null when nothing
 * remains after trimming — such entries are discarded (design.md
 * AgenticEngine output-mapping rule 2).
 */
const normalizeSuggestionPath = (rawPath: string): string | null => {
  const trimmed = rawPath.trim();
  if (trimmed === '') {
    return null;
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
};

type NormalizedSuggestion = {
  readonly path: string;
  readonly label: string;
  readonly description: string;
};

/**
 * Output-mapping rules 2-4 (design.md AgenticEngine): normalize each path
 * (discarding entries that cannot be normalized), de-duplicate by
 * normalized path keeping the first occurrence, then cap the list — the
 * schema's maxItems is advisory for the model, so the adapter enforces
 * the cap itself.
 */
const toNormalizedSuggestions = (
  output: AgenticEngineOutput,
): NormalizedSuggestion[] => {
  const seenPaths = new Set<string>();
  const normalized: NormalizedSuggestion[] = [];

  for (const suggestion of output.suggestions) {
    const path = normalizeSuggestionPath(suggestion.path);
    if (path == null || seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    normalized.push({
      path,
      label: suggestion.label,
      description: suggestion.description,
    });
  }

  return normalized.slice(0, SUGGESTION_CAP);
};

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
  // Tracked separately from the search budget on purpose: listChildren runs a
  // light Mongo path query (no Elasticsearch), so it must not deplete the ES
  // search budget the agent needs to locate candidate shelves.
  const childListingLimit = configManager.getConfig(
    'aiTools:suggestPathAgenticChildListingLimit',
  );
  const timeoutMs = configManager.getConfig(
    'aiTools:suggestPathAgenticTimeoutMs',
  );
  // Read per request so a config change is reflected without restart, mirroring
  // the model/limit/timeout reads above. Empty means "unset": no reasoning
  // effort is forwarded and the model's default behavior is left unchanged.
  const reasoningEffort = configManager.getConfig(
    'openai:reasoningEffort:suggestPathAgent',
  );

  // The request context MUST be built per request — a module-scope instance
  // would leak `user` (and the search budget) across concurrent requests.
  const requestContext = new RequestContext<SuggestPathRequestContextShape>();
  requestContext.set('user', user);
  // The engine input carries the narrow engine-facing view of the search
  // service (suggest-path-types SearchService); at runtime it is the full
  // ~/server/service/search instance, which the route narrowed the same way
  // in reverse. Widen it back here at the mastra platform boundary.
  requestContext.set(
    'searchService',
    searchService as unknown as SearchServiceImpl,
  );
  // Kept as a local reference: the budget is the primary source for the
  // trace (searchCount, executed-query sequence) after the agent loop ran.
  const searchBudget: SuggestPathRequestContextShape['searchBudget'] = {
    limit: searchLimit,
    used: 0,
    queries: [],
  };
  requestContext.set('searchBudget', searchBudget);
  // The listChildren budget is independent of the search budget (see the
  // childListingLimit comment above): peer-verification drill-ins draw from
  // this pool, not from the ES search pool.
  const childListingBudget: SuggestPathRequestContextShape['childListingBudget'] =
    {
      limit: childListingLimit,
      used: 0,
      paths: [],
    };
  requestContext.set('childListingBudget', childListingBudget);

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
  // trace emitter reads whatever is known at emission time, so a reject
  // after validation still reports the classified informationType while an
  // earlier reject reports explicit nulls (one consistent line shape — the
  // summary is an operational contract parsed by the #183968 evaluator).
  let result: GenerateResultView | undefined;
  let informationType: AgenticEngineOutput['informationType'] | null = null;
  let suggestionCount = 0;

  const emitTraceLogs = (stopReason: StopReason): void => {
    // Logging must never alter engine behavior: any unexpected failure in
    // trace reconstruction is contained here instead of propagating.
    try {
      const toolCalls = extractToolCallRecords(result?.steps);
      // info carries meta information only — document body and the
      // body-derived search queries are restricted to debug level
      // (design.md privacy constraint).
      logger.info(
        {
          durationMs: Date.now() - startedAt,
          searchCount: searchBudget.used,
          // Tracked next to searchCount so a measurement run can tell, from
          // the summary alone, whether peer-verification drill-ins actually
          // fired (parallels searchCount for the #183968 evaluator).
          listChildrenCount: childListingBudget.used,
          pageReadCount: toolCalls.filter(
            (call) => call.toolName === GET_PAGE_CONTENT_TOOL_NAME,
          ).length,
          stopReason,
          informationType,
          suggestionCount,
          tokenUsage: pickTokenUsage(result?.totalUsage),
        },
        'suggest-path agentic exploration summary',
      );
      logger.debug(
        {
          queries: [...searchBudget.queries],
          listedPaths: [...childListingBudget.paths],
          searchResults: extractSearchHitSummaries(result?.steps),
          toolCallSequence: toolCalls,
        },
        'suggest-path agentic exploration trace',
      );
    } catch (logErr) {
      logger.warn(
        'failed to emit suggest-path agentic exploration trace logs',
        logErr,
      );
    }
  };

  try {
    // Inline wrapper so the timer is ALWAYS cleared once generate settles
    // (success or failure), while `result` stays in scope for the mapping
    // and the trace emission below.
    result = await (async () => {
      try {
        return await agent.generate(buildUserPrompt(body), {
          structuredOutput: { schema: AGENTIC_OUTPUT_JSON_SCHEMA },
          // Step ceiling as a secondary defense against loop runaway (the
          // budgets and the timeout are the primary controls): each search and
          // each listChildren call can cost up to 2 steps (tool call +
          // follow-up reasoning), +4 covers classification and final shaping
          // (design.md call contract).
          maxSteps: 2 * searchLimit + 2 * childListingLimit + 4,
          abortSignal: controller.signal,
          requestContext,
          // Pass reasoning effort only when configured; an empty value leaves
          // the model's default behavior unchanged. Shape follows the existing
          // chat-side precedent (features/mastra/.../post-message.ts). Value
          // validity per model is the provider's concern, not enforced here —
          // an unsupported combination surfaces as a provider error and is
          // absorbed by the memo fallback (design.md AgenticEngine, 3.5/3.6).
          ...(reasoningEffort !== ''
            ? { providerOptions: { openai: { reasoningEffort } } }
            : {}),
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

    const normalized = toNormalizedSuggestions(output);

    // Grants are resolved in parallel (output-mapping rule 4). A grant
    // resolution failure rejects the whole engine via Promise.all — matching
    // the oneshot evaluate-pipeline semantics, where one grant failure fails
    // the whole search-suggestion branch; the orchestrator's memo fallback
    // absorbs the rejection (Requirement 4.5).
    const suggestions = await Promise.all(
      normalized.map(async (suggestion): Promise<PathSuggestion> => {
        const grant = await resolveParentGrant(suggestion.path);
        return {
          type: SuggestionType.SEARCH,
          path: suggestion.path,
          label: suggestion.label,
          description: suggestion.description,
          grant,
          informationType: output.informationType,
        };
      }),
    );
    suggestionCount = suggestions.length;

    // stopReason rules (design.md): budget_exhausted = normal completion
    // with the search budget fully used; completed = any other normal run.
    emitTraceLogs(
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
    emitTraceLogs(controller.signal.aborted ? 'timeout' : 'error');
    throw err;
  }
};
