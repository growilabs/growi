import type { LanguageModelMiddleware } from 'ai';

// Anthropic caches nothing unless the request carries cache_control (OpenAI and
// Google cache implicitly). `@ai-sdk/anthropic` forwards the call-level
// `anthropic.cacheControl` as the request's top-level cache_control, so the cache
// breakpoint follows the newest content on every tool-loop step.
//
// An admin-configured `anthropic.cacheControl` wins; `null` is the opt-out (the SDK
// rejects null, so it is dropped here instead of failing the whole request).
// Type-only import: this module is reachable from the provider graph and must not
// pull `ai` in eagerly (see no-eager-provider-imports.spec.ts).
export const anthropicCacheControlMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  transformParams: ({ params }) => {
    const { cacheControl, ...anthropicOptions } =
      params.providerOptions?.anthropic ?? {};

    return Promise.resolve({
      ...params,
      providerOptions: {
        ...params.providerOptions,
        anthropic: {
          ...anthropicOptions,
          ...(cacheControl === null
            ? {}
            : { cacheControl: cacheControl ?? { type: 'ephemeral' } }),
        },
      },
    });
  },
};
