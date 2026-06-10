import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';

import { isAiEnabled } from '~/features/openai/server/services';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { resolveMastraModel } from '../services/ai-sdk-modules/resolve-mastra-model';

const logger = loggerFactory('growi:routes:apiv3:mastra');

export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();

  // Boot-time availability gate. The catch-all is registered SYNCHRONOUSLY
  // before the real routes (which are registered via async `import().then()`),
  // so it shadows them. The gate requires BOTH AI being enabled AND the model
  // resolver being `ok`; otherwise the real routes never become reachable.
  if (!isAiEnabled()) {
    router.all('*', (_req, res: ApiV3Response) => {
      return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
    });
  } else {
    const resolution = resolveMastraModel();
    if (resolution.status === 'disabled') {
      // Log the reason TYPE only (plus vendor when present) — never the apiKey
      // (Req 2.5/4.2). The disabled reason union carries no apiKey, but we keep
      // the logged payload explicit so a future reason shape cannot leak one.
      const { reason } = resolution;
      logger.error(
        {
          reason: reason.type,
          ...('vendor' in reason ? { vendor: reason.vendor } : {}),
        },
        'Mastra chat agent disabled',
      );

      // Client-facing message is intentionally generic: do NOT leak the
      // specific reason to the client (Req 2.5/info-leak).
      router.all('*', (_req, res: ApiV3Response) => {
        return res.apiv3Err(new ErrorV3('AI assistant is not available'), 503);
      });
    }
  }

  // Real routes. When the gate above registered a catch-all, these are shadowed
  // by it; when the resolver is `ok`, no catch-all exists and they are active.
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

  return router;
};
