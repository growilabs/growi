import type { MastraModelConfig } from '@mastra/core/llm';

import type { LlmVendor } from '~/features/mastra/interfaces/llm-vendor';
import { isLlmVendor } from '~/features/mastra/interfaces/llm-vendor';
import { configManager } from '~/server/service/config-manager';
import type { ConfigKey } from '~/server/service/config-manager/config-definition';

import { llmModelFactories } from './llm-providers';

export type MastraModelDisabledReason =
  | { type: 'vendor-unset' }
  | { type: 'vendor-invalid'; value: string } // value = raw env string (NOT a key)
  | { type: 'api-key-missing'; vendor: LlmVendor };

export type MastraModelResolution =
  | { status: 'ok'; vendor: LlmVendor; model: MastraModelConfig }
  | { status: 'disabled'; reason: MastraModelDisabledReason };

// Per-vendor config key maps. Data-driven so the happy path has no per-vendor
// `if` ladder: the selected vendor indexes both maps. apiKey values are
// `string | undefined`; model values are `string` (config defaults guarantee a
// value) — getConfig over this union collapses to compatible value types, so
// no cast is needed.
const apiKeyConfigKeys = {
  openai: 'openai:apiKey',
  anthropic: 'anthropic:apiKey',
  google: 'google:apiKey',
} as const satisfies Record<LlmVendor, ConfigKey>;

const modelConfigKeys = {
  openai: 'openai:assistantModel:mastraAgent',
  anthropic: 'anthropic:assistantModel:mastraAgent',
  google: 'google:assistantModel:mastraAgent',
} as const satisfies Record<LlmVendor, ConfigKey>;

// Memoize the ok resolution so the native provider object is built once and
// reused across calls. Disabled results are intentionally NOT memoized: a
// config fix should take effect on the next call without re-importing the module.
let memoizedOk: Extract<MastraModelResolution, { status: 'ok' }> | undefined;

export const resolveMastraModel = (): MastraModelResolution => {
  if (memoizedOk != null) {
    return memoizedOk;
  }

  const vendor = configManager.getConfig('mastra:llmVendor');
  if (vendor == null) {
    return { status: 'disabled', reason: { type: 'vendor-unset' } };
  }

  if (!isLlmVendor(vendor)) {
    return {
      status: 'disabled',
      reason: { type: 'vendor-invalid', value: vendor },
    };
  }

  // Read ONLY the selected vendor's keys (Req 3.2).
  const apiKey = configManager.getConfig(apiKeyConfigKeys[vendor]);
  if (apiKey == null) {
    return {
      status: 'disabled',
      reason: { type: 'api-key-missing', vendor },
    };
  }

  // Model is unset -> config default (Req 2.3).
  const model = configManager.getConfig(modelConfigKeys[vendor]);

  const resolved: Extract<MastraModelResolution, { status: 'ok' }> = {
    status: 'ok',
    vendor,
    model: llmModelFactories[vendor]({ apiKey, model }),
  };
  memoizedOk = resolved;
  return resolved;
};
