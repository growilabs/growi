import express from 'express';

import { listRegisteredRoutes } from './express-route-walker';

describe('listRegisteredRoutes', () => {
  const buildApp = () => {
    const app = express();
    const inner = express.Router();
    inner.get(
      '/pages/:id',
      function auth() {},
      function body() {},
    );
    inner.post('/pages/:id/comments', function body() {});
    const outer = express.Router();
    outer.use('/inner', inner);
    app.use('/_api/v3', outer);
    app.get('/health', function healthBody() {});
    return app;
  };

  it('lists every route with its full pattern and HTTP method', () => {
    const routes = listRegisteredRoutes(buildApp());

    expect(routes.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: 'GET', path: '/_api/v3/inner/pages/:id' },
      { method: 'POST', path: '/_api/v3/inner/pages/:id/comments' },
      { method: 'GET', path: '/health' },
    ]);
  });

  it('returns handler names in registration order, route body last', () => {
    const routes = listRegisteredRoutes(buildApp());

    expect(routes[0].middlewareNames).toEqual(['auth', 'body']);
  });
});
