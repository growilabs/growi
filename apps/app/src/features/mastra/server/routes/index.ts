import express from 'express';

import type Crowi from '~/server/crowi';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  import('./post-message').then(({ postMessageHandlersFactory }) => {
    router.post('/message', postMessageHandlersFactory(crowi));
  });

  return router;
};
