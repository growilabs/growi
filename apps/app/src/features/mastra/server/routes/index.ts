import express from 'express';

import type Crowi from '~/server/crowi';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  // disable all routes if AI is not enabled
  // if (!isAiEnabled()) {
  //   router.all('*', (req, res: ApiV3Response) => {
  //     return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
  //   });
  // }

  // enabled
  import('./post-message').then(({ postMessageHandlersFactory }) => {
    router.post('/message', postMessageHandlersFactory());
  });

  return router;
};
