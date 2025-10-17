import express, { type Router } from 'express';
import CertifyOrigin from '~/server/middlewares/certify-origin';

function createApiRouter(): Router {
  const router = express.Router();
  router.use(CertifyOrigin);
  return router;
}

export {
  createApiRouter,
};
