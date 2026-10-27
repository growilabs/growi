/**
 * Pure helpers that reconstruct the agentic exploration trace from the
 * runtime-observed shape of Mastra's generate result (research.md "Spike
 * Results" item 4: tool calls at `steps[i].toolCalls[j].payload.{toolName,args}`,
 * tool results at `steps[i].toolResults[j].payload.result`, usage in AI SDK
 * v5 naming on `totalUsage`), plus the emitter that turns them into the
 * one-info-summary + one-debug-trace log pair.
 *
 * All inputs are treated as `unknown` and walked defensively: a missing or
 * malformed shape yields empty/zero values instead of throwing, because the
 * logging path must never alter engine behavior (design.md "AgenticEngine >
 * State Management").
 */

import type { SuggestPathRequestContextShape } from '~/features/mastra/server/services/mastra-modules/agents/suggest-path';
import type loggerFactory from '~/utils/logger';

import type { AgenticEngineOutput } from './agentic-output-schema';

/**
 * Tool-record keys as registered on suggestPathAgent — these are the
 * runtime `toolName` values observed in steps.
 */
export const FULL_TEXT_SEARCH_TOOL_NAME = 'fullTextSearch';
export const GET_PAGE_CONTENT_TOOL_NAME = 'getPageContent';

export type StopReason = 'timeout' | 'budget_exhausted' | 'error' | 'completed';

export type ToolCallRecord = {
  readonly toolName: string;
  readonly args: unknown;
};

export type SearchHitSummary = {
  readonly resultKind: string;
  readonly totalCount: number | null;
  readonly hitPaths: readonly string[];
};

export type TokenUsage = {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null
    ? (value as Record<string, unknown>)
    : null;

const asNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

/**
 * Reconstruct the tool-call sequence (toolName + args per call, in step
 * order) from `result.steps`. Used both for the debug trace and for
 * counting getPageContent reads in the info summary.
 */
export const extractToolCallRecords = (steps: unknown): ToolCallRecord[] => {
  if (!Array.isArray(steps)) {
    return [];
  }
  const records: ToolCallRecord[] = [];
  for (const step of steps) {
    const toolCalls = asRecord(step)?.toolCalls;
    if (!Array.isArray(toolCalls)) {
      continue;
    }
    for (const call of toolCalls) {
      const payload = asRecord(asRecord(call)?.payload);
      if (payload == null || typeof payload.toolName !== 'string') {
        continue;
      }
      records.push({ toolName: payload.toolName, args: payload.args });
    }
  }
  return records;
};

/**
 * Reduce one fullTextSearch tool result (the LimitedSearchTool
 * discriminated union) to a privacy-safe summary: the union kind, the
 * total hit count, and the hit page paths. Snippets are intentionally
 * dropped — they are page-body excerpts and must stay out of logs
 * (design.md privacy constraint).
 */
const summarizeSearchResult = (result: unknown): SearchHitSummary => {
  const record = asRecord(result);
  const hits = record?.hits;
  const hitPaths = Array.isArray(hits)
    ? hits.flatMap((hit) => {
        const pagePath = asRecord(hit)?.pagePath;
        return typeof pagePath === 'string' ? [pagePath] : [];
      })
    : [];
  return {
    resultKind: typeof record?.result === 'string' ? record.result : 'unknown',
    totalCount: asNumberOrNull(record?.totalCount),
    hitPaths,
  };
};

/**
 * Collect a summary per fullTextSearch result from `result.steps`. Results
 * of other tools are excluded entirely — getPageContent results contain
 * page bodies, which never enter the logs.
 */
export const extractSearchHitSummaries = (
  steps: unknown,
): SearchHitSummary[] => {
  if (!Array.isArray(steps)) {
    return [];
  }
  const summaries: SearchHitSummary[] = [];
  for (const step of steps) {
    const toolResults = asRecord(step)?.toolResults;
    if (!Array.isArray(toolResults)) {
      continue;
    }
    for (const toolResult of toolResults) {
      const payload = asRecord(asRecord(toolResult)?.payload);
      if (payload == null || payload.toolName !== FULL_TEXT_SEARCH_TOOL_NAME) {
        continue;
      }
      summaries.push(summarizeSearchResult(payload.result));
    }
  }
  return summaries;
};

/**
 * Pick the AI SDK v5 token fields from `result.totalUsage` (`inputTokens` /
 * `outputTokens` / `totalTokens` — the v4 names promptTokens /
 * completionTokens do not exist on @mastra/core 1.41.0). `totalUsage` is
 * preferred over `usage` because its meaning (cross-step total) is
 * unambiguous; the runtime-only `raw` field is deliberately not read
 * (absent from the bundled LanguageModelV2Usage type).
 */
export const pickTokenUsage = (totalUsage: unknown): TokenUsage | null => {
  const record = asRecord(totalUsage);
  if (record == null) {
    return null;
  }
  return {
    inputTokens: asNumberOrNull(record.inputTokens),
    outputTokens: asNumberOrNull(record.outputTokens),
    totalTokens: asNumberOrNull(record.totalTokens),
  };
};

type Logger = ReturnType<typeof loggerFactory>;

/**
 * Everything the trace emitter needs, passed explicitly at emission time.
 * The engine hands over whatever is known when the run settles: an early
 * reject reports explicit nulls, a late reject reports the classified
 * informationType — one consistent line shape either way (the summary is an
 * operational contract parsed by the #183968 evaluator).
 */
export interface AgenticTraceState {
  readonly startedAt: number;
  readonly searchBudget: SuggestPathRequestContextShape['searchBudget'];
  readonly childListingBudget: SuggestPathRequestContextShape['childListingBudget'];
  readonly result:
    | { readonly steps?: unknown; readonly totalUsage?: unknown }
    | undefined;
  readonly informationType: AgenticEngineOutput['informationType'] | null;
  readonly suggestionCount: number;
}

/**
 * Emit the one-info-summary + one-debug-trace pair for a settled agentic
 * run. The logger is injected so the lines keep the engine's logger
 * namespace (part of the operational summary contract).
 *
 * Logging must never alter engine behavior: any unexpected failure in trace
 * reconstruction is contained here instead of propagating.
 */
export const emitAgenticTraceLogs = (
  logger: Logger,
  stopReason: StopReason,
  state: AgenticTraceState,
): void => {
  try {
    const toolCalls = extractToolCallRecords(state.result?.steps);
    // info carries meta information only — document body and the
    // body-derived search queries are restricted to debug level
    // (design.md privacy constraint).
    logger.info(
      {
        durationMs: Date.now() - state.startedAt,
        searchCount: state.searchBudget.used,
        // Tracked next to searchCount so a measurement run can tell, from
        // the summary alone, whether peer-verification drill-ins actually
        // fired (parallels searchCount for the #183968 evaluator).
        listChildrenCount: state.childListingBudget.used,
        pageReadCount: toolCalls.filter(
          (call) => call.toolName === GET_PAGE_CONTENT_TOOL_NAME,
        ).length,
        stopReason,
        informationType: state.informationType,
        suggestionCount: state.suggestionCount,
        tokenUsage: pickTokenUsage(state.result?.totalUsage),
      },
      'suggest-path agentic exploration summary',
    );
    logger.debug(
      {
        queries: [...state.searchBudget.queries],
        listedPaths: [...state.childListingBudget.paths],
        searchResults: extractSearchHitSummaries(state.result?.steps),
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
