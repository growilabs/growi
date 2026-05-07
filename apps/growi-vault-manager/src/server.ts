import type { PlatformApplication } from '@tsed/common';
import { Configuration, Inject } from '@tsed/di';
import express from 'express';
import '@tsed/swagger';
import '@tsed/terminus';

import '@tsed/platform-express';

// Default port per requirement 10.1
const PORT = Number(process.env.PORT || 3001);

@Configuration({
  port: PORT,
  acceptMimes: ['application/json'],
  mount: {
    '/': [],
  },
  middlewares: [
    'json-parser',
    express.json({ limit: '10mb' }),
    express.urlencoded({ extended: true, limit: '10mb' }),
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
