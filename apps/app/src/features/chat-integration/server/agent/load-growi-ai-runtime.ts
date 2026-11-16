import type SearchService from '~/server/service/search';

import type {
  GrowiAiRuntime,
  GrowiAiRuntimeLoader,
} from './growi-ai-gateway-types';

/**
 * Shares one load between concurrent callers and keeps the loaded runtime; a
 * failed load is forgotten so the next call tries again.
 */
export const createGrowiAiRuntimeLoader = (
  importRuntime: () => Promise<GrowiAiRuntime>,
): GrowiAiRuntimeLoader => {
  let loading: Promise<GrowiAiRuntime> | undefined;
  return () => {
    if (loading == null) {
      const attempt = importRuntime();
      loading = attempt;
      attempt.catch(() => {
        if (loading === attempt) {
          loading = undefined;
        }
      });
    }
    return loading;
  };
};

/**
 * The production loader. The dynamic import() is the boundary that keeps the
 * AI stack out of the boot-time module graph (no-eager-ai-imports.spec.ts).
 */
export const growiAiRuntimeLoaderFor = (
  searchService: SearchService,
): GrowiAiRuntimeLoader =>
  createGrowiAiRuntimeLoader(async () =>
    (await import('./growi-ai-runtime')).createGrowiAiRuntime(searchService),
  );
