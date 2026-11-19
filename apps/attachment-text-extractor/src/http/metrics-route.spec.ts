import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import { mock } from 'vitest-mock-extended';

import type { AppEnv } from './app-env';
import { countResponses } from './metrics-route';
import type { ServiceMetrics } from './service-metrics';

// The 500 Hono itself builds for a route that threw is an answer too: the
// counter must see it, not only the answers a route returned.
describe('countResponses', () => {
  it('counts the 500 Hono returns for a route that threw', async () => {
    // Hono's default error handler logs the thrown error to the console.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const metrics = mock<ServiceMetrics>();
    const app = new Hono<AppEnv>();
    app.use(countResponses(metrics));
    app.post('/extract', () => {
      throw new Error('unexpected');
    });
    const bindings: HttpBindings = {
      incoming: mock<IncomingMessage>({ url: '/extract' }),
      outgoing: mock<ServerResponse>(),
    };

    const answer = await app.request('/extract', { method: 'POST' }, bindings);

    expect(answer.status).toBe(500);
    expect(metrics.countResponse).toHaveBeenCalledTimes(1);
    expect(metrics.countResponse).toHaveBeenCalledWith('/extract', 500);
  });
});
