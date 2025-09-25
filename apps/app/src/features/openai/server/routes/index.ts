import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { isAiEnabled } from '../services';

const router = express.Router();


export const factory = (crowi: Crowi): express.Router => {

  // disable all routes if AI is not enabled
  if (!isAiEnabled()) {
    router.all('*', (req, res: ApiV3Response) => {
      return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
    });
  }
  // enabled
  else {
    import('./thread').then(({ createThreadHandlersFactory }) => {
      router.post('/thread', createThreadHandlersFactory(crowi));
    });

    import('./get-recent-threads').then(({ getRecentThreadsFactory }) => {
      router.get('/threads/recent', getRecentThreadsFactory(crowi));
    });

    import('./get-threads').then(({ getThreadsFactory }) => {
      router.get('/threads/:aiAssistantId', getThreadsFactory(crowi));
    });

    import('./delete-thread').then(({ deleteThreadFactory }) => {
      router.delete('/thread/:aiAssistantId/:threadRelationId', deleteThreadFactory(crowi));
    });

    import('./message').then(({ getMessagesFactory, postMessageHandlersFactory }) => {
      router.post('/message', postMessageHandlersFactory(crowi));
      router.get('/messages/:aiAssistantId/:threadId', getMessagesFactory(crowi));
    });

    import('./edit').then(({ postMessageToEditHandlersFactory }) => {
      router.post('/edit', postMessageToEditHandlersFactory(crowi));
    });

    import('./ai-assistant').then(({ createAiAssistantFactory }) => {
      router.post('/ai-assistant', createAiAssistantFactory(crowi));
    });

    import('./ai-assistants').then(({ getAiAssistantsFactory }) => {
      router.get('/ai-assistants', getAiAssistantsFactory(crowi));
    });

    import('./update-ai-assistant').then(({ updateAiAssistantsFactory }) => {
      router.put('/ai-assistant/:id', updateAiAssistantsFactory(crowi));
    });

    import('./set-default-ai-assistant').then(({ setDefaultAiAssistantFactory }) => {
      router.put('/ai-assistant/:id/set-default', setDefaultAiAssistantFactory(crowi));
    });

    import('./delete-ai-assistant').then(({ deleteAiAssistantsFactory }) => {
      router.delete('/ai-assistant/:id', deleteAiAssistantsFactory(crowi));
    });
  }

  return router;
};
