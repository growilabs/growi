import express from 'express';

import type Crowi from '~/server/crowi';

import { aiReadyGuard } from './ai-ready-guard';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  // Gate every mastra route on a per-request availability check (enabled AND
  // configured). Applied via router.use so readiness is re-evaluated on each
  // request — a toggle/config change takes effect without a restart (Req 7.5).
  router.use(aiReadyGuard);

  import('./post-message').then(({ postMessageHandlersFactory }) => {
    router.post('/message', postMessageHandlersFactory(crowi));
  });

  import('./get-threads').then(({ getThreadsFactory }) => {
    router.get('/threads', getThreadsFactory(crowi));
  });

  import('./delete-thread').then(({ deleteThreadHandlersFactory }) => {
    router.delete('/thread/:threadId', deleteThreadHandlersFactory(crowi));
  });

  import('./get-messages').then(({ getMessagesHandlersFactory }) => {
    router.get('/messages/:threadId', getMessagesHandlersFactory(crowi));
  });

  import('./get-models').then(({ getModelsFactory }) => {
    router.get('/models', getModelsFactory(crowi));
  });

  return router;
};
