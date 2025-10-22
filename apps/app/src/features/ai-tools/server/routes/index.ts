import express from 'express';

import type Crowi from '~/server/crowi';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  return router;
};
