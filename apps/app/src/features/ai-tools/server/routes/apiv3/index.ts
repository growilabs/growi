import express from 'express';

import { aiReadyGuard } from '~/features/mastra/server/routes/ai-ready-guard';
import type Crowi from '~/server/crowi';

// Import and wire the terminal handlers. Called lazily (see factory below):
// the suggest-path handler module statically pulls the agentic engine, whose
// import graph reaches the heavy @mastra / ai-sdk packages (~140MB RSS), so
// it must not load while the router is merely mounted. Mirrors
// features/mastra/server/routes/index.ts (guarded by no-eager-ai-imports.spec).
const loadHandlersRouter = async (crowi: Crowi): Promise<express.Router> => {
  const { suggestPathHandlersFactory } = await import(
    '~/features/ai-tools/suggest-path/server/routes/apiv3'
  );

  const router = express.Router();
  router.post('/suggest-path', suggestPathHandlersFactory(crowi));
  return router;
};

export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();

  // Reject before touching the heavy stack, so instances with AI disabled
  // never load it. The same middleware also runs inside the handler chain
  // (whose per-route contract is unchanged); it only reads config-derived
  // state, so the double check is harmless.
  router.use(aiReadyGuard);

  // The terminal handlers are loaded by the FIRST request that passes the
  // guard, then reused. A failed load is retried on the next request instead
  // of being cached.
  let handlersRouterPromise: Promise<express.Router> | null = null;
  router.use(async (req, res, next) => {
    try {
      handlersRouterPromise ??= loadHandlersRouter(crowi);
      const handlersRouter = await handlersRouterPromise;
      handlersRouter(req, res, next);
    } catch (err) {
      handlersRouterPromise = null;
      next(err);
    }
  });

  return router;
};
