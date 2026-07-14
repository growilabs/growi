import express from 'express';

import type Crowi from '~/server/crowi';

import { aiReadyGuard } from './ai-ready-guard';

// Import and wire every terminal handler. Called lazily (see factory below):
// the handler modules statically pull the whole @mastra / ai-sdk graph
// (~140MB RSS), so they must not load while the router is merely mounted.
const loadHandlersRouter = async (crowi: Crowi): Promise<express.Router> => {
  const [
    { postMessageHandlersFactory },
    { getThreadsFactory },
    { deleteThreadHandlersFactory },
    { getMessagesHandlersFactory },
    { getModelsFactory },
  ] = await Promise.all([
    import('./post-message'),
    import('./get-threads'),
    import('./delete-thread'),
    import('./get-messages'),
    import('./get-models'),
  ]);

  const router = express.Router();
  router.post('/message', postMessageHandlersFactory(crowi));
  router.get('/threads', getThreadsFactory(crowi));
  router.delete('/thread/:threadId', deleteThreadHandlersFactory(crowi));
  router.get('/messages/:threadId', getMessagesHandlersFactory(crowi));
  router.get('/models', getModelsFactory(crowi));
  return router;
};

export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();

  // Gate every mastra route on a per-request availability check (enabled AND
  // configured). Applied via router.use so readiness is re-evaluated on each
  // request — a toggle/config change takes effect without a restart (Req 7.5).
  router.use(aiReadyGuard);

  // The terminal handlers are loaded by the FIRST request that passes the
  // guard, then reused. Instances that never use AI (aiReadyGuard rejects
  // everything) never load the AI stack, keeping their baseline memory free of
  // it. A failed load is retried on the next request instead of being cached.
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
