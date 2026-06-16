import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';

import { isAiEnabled } from '~/features/openai/server/services';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

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
    import('~/features/openai/server/routes/thread').then(
      ({ createThreadHandlersFactory }) => {
        router.post('/thread', createThreadHandlersFactory(crowi));
      },
    );

    import('~/features/openai/server/routes/get-recent-threads').then(
      ({ getRecentThreadsFactory }) => {
        router.get('/threads/recent', getRecentThreadsFactory(crowi));
      },
    );

    import('~/features/openai/server/routes/get-threads').then(
      ({ getThreadsFactory }) => {
        router.get('/threads/:aiAssistantId', getThreadsFactory(crowi));
      },
    );

    import('~/features/openai/server/routes/delete-thread').then(
      ({ deleteThreadFactory }) => {
        router.delete(
          '/thread/:aiAssistantId/:threadRelationId',
          deleteThreadFactory(crowi),
        );
      },
    );

    import('~/features/openai/server/routes/message').then(
      ({ getMessagesFactory, postMessageHandlersFactory }) => {
        router.post('/message', postMessageHandlersFactory(crowi));
        router.get(
          '/messages/:aiAssistantId/:threadId',
          getMessagesFactory(crowi),
        );
      },
    );

    import('~/features/openai/server/routes/edit').then(
      ({ postMessageToEditHandlersFactory }) => {
        router.post('/edit', postMessageToEditHandlersFactory(crowi));
      },
    );

    import('~/features/openai/server/routes/ai-assistant').then(
      ({ createAiAssistantFactory }) => {
        router.post('/ai-assistant', createAiAssistantFactory(crowi));
      },
    );

    import('~/features/openai/server/routes/ai-assistants').then(
      ({ getAiAssistantsFactory }) => {
        router.get('/ai-assistants', getAiAssistantsFactory(crowi));
      },
    );

    import('~/features/openai/server/routes/update-ai-assistant').then(
      ({ updateAiAssistantsFactory }) => {
        router.put('/ai-assistant/:id', updateAiAssistantsFactory(crowi));
      },
    );

    import('~/features/openai/server/routes/set-default-ai-assistant').then(
      ({ setDefaultAiAssistantFactory }) => {
        router.put(
          '/ai-assistant/:id/set-default',
          setDefaultAiAssistantFactory(crowi),
        );
      },
    );

    import('~/features/openai/server/routes/delete-ai-assistant').then(
      ({ deleteAiAssistantsFactory }) => {
        router.delete('/ai-assistant/:id', deleteAiAssistantsFactory(crowi));
      },
    );
  }

  return router;
};
