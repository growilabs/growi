import { getAvailableModels } from './ai-sdk-modules/llm-providers/provider-availability';
import { isAiEnabled } from './is-ai-enabled';

// "Is AI configured?" in the multi-provider model means: at least one AVAILABLE
// provider (enabled AND configured) has at least one allowed model under it
// (Req 6.2). That judgement is owned by provider-availability (design D3), not
// re-derived here: getAvailableModels() already filters the operator's allow-list
// down to entries whose owning provider is available, so a non-empty result is
// exactly this condition. Delegating keeps the enabled-and-configured semantics
// from drifting between is-ai-configured, get-models, and effective-model-key.
//
// An empty result is the single collapsed observation of every "unconfigured"
// cause: all providers disabled, all enabled providers misconfigured, or only the
// removed legacy single-provider settings remain (ai:provider / ai:apiKey /
// ai:azureOpenaiSettings no longer exist, so ai:providers is unset => no available
// providers => []). In all of these AI reads as not-configured and the app
// continues (chat disabled via the existing ai-ready-guard 501) — Req 6.3, 7.3.
export const isAiConfigured = (): boolean => getAvailableModels().length > 0;

// AI is usable only when it is both turned on and configured. Single verdict
// shared by the mastra route guard and the sidebar supplier.
export const isAiReady = (): boolean => isAiEnabled() && isAiConfigured();
