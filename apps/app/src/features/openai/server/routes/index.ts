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
    import('./rebuild-vector-store').then(({ rebuildVectorStoreHandlersFactory }) => {
      router.post('/rebuild-vector-store', rebuildVectorStoreHandlersFactory(crowi));
    });

    import('./thread').then(({ createThreadHandlersFactory }) => {
      router.post('/thread', createThreadHandlersFactory(crowi));
    });

    import('./message').then(({ postMessageHandlersFactory }) => {
      router.post('/message', postMessageHandlersFactory(crowi));
    });
  }

  return router;
};
