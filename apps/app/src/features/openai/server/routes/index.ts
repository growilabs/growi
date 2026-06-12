import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';

import type Crowi from '~/server/crowi/index.js';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response.js';

import { isAiEnabled } from '../services/index.js';

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
    import('./thread.js').then(({ createThreadHandlersFactory }) => {
      router.post('/thread', createThreadHandlersFactory(crowi));
    });

    import('./get-recent-threads.js').then(({ getRecentThreadsFactory }) => {
      router.get('/threads/recent', getRecentThreadsFactory(crowi));
    });

    import('./get-threads.js').then(({ getThreadsFactory }) => {
      router.get('/threads/:aiAssistantId', getThreadsFactory(crowi));
    });

    import('./delete-thread.js').then(({ deleteThreadFactory }) => {
      router.delete(
        '/thread/:aiAssistantId/:threadRelationId',
        deleteThreadFactory(crowi),
      );
    });

    import('./message/index.js').then(
      ({ getMessagesFactory, postMessageHandlersFactory }) => {
        router.post('/message', postMessageHandlersFactory(crowi));
        router.get(
          '/messages/:aiAssistantId/:threadId',
          getMessagesFactory(crowi),
        );
      },
    );

    import('./edit/index.js').then(({ postMessageToEditHandlersFactory }) => {
      router.post('/edit', postMessageToEditHandlersFactory(crowi));
    });

    import('./ai-assistant.js').then(({ createAiAssistantFactory }) => {
      router.post('/ai-assistant', createAiAssistantFactory(crowi));
    });

    import('./ai-assistants.js').then(({ getAiAssistantsFactory }) => {
      router.get('/ai-assistants', getAiAssistantsFactory(crowi));
    });

    import('./update-ai-assistant.js').then(({ updateAiAssistantsFactory }) => {
      router.put('/ai-assistant/:id', updateAiAssistantsFactory(crowi));
    });

    import('./set-default-ai-assistant.js').then(
      ({ setDefaultAiAssistantFactory }) => {
        router.put(
          '/ai-assistant/:id/set-default',
          setDefaultAiAssistantFactory(crowi),
        );
      },
    );

    import('./delete-ai-assistant.js').then(({ deleteAiAssistantsFactory }) => {
      router.delete('/ai-assistant/:id', deleteAiAssistantsFactory(crowi));
    });
  }

  return router;
};
