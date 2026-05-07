import { Configuration, Inject } from '@tsed/di';
import express from 'express';
import { __decorate, __metadata } from 'tslib';
import '@tsed/swagger';
import '@tsed/terminus';
import '@tsed/platform-express';
// Default port per requirement 10.1
const PORT = Number(process.env.PORT || 3001);
let Server = class Server {
  app;
};
__decorate(
  [Inject(), __metadata('design:type', Object)],
  Server.prototype,
  'app',
  void 0,
);
Server = __decorate(
  [
    Configuration({
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
    }),
  ],
  Server,
);
export default Server;
//# sourceMappingURL=server.js.map
