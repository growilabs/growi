import { PlatformApplication } from '@tsed/common';
import { Configuration, Inject } from '@tsed/di';
import express from 'express';
import '@tsed/swagger';
import '@tsed/terminus';

import * as Controllers from './controllers/index.js';

import '@tsed/platform-express';

const PORT = Number(process.env.PORT || 3010);

@Configuration({
  port: PORT,
  acceptMimes: ['application/json'],
  mount: {
    '/': [...Object.values(Controllers)],
  },
  middlewares: [
    'json-parser',
    express.json({ limit: '50mb' }),
    express.urlencoded({ extended: true, limit: '50mb' }),
  ],
  swagger: [
    {
      path: '/v3/docs',
      specVersion: '3.0.1',
    },
  ],
  terminus: {
    signals: ['SIGINT', 'SIGTERM'],
  },
})
class Server {
  @Inject()
  app: PlatformApplication | undefined;
}

export default Server;
