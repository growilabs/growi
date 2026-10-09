import type { PlatformName } from '@growi/chat';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { REQUIRES_INBOUND_REACHABILITY } from '../capabilities/index.js';
import { registerWebhookRoutes, webhookPath } from './webhook-routes.js';

const harness = (
  handler: (request: Request) => Promise<Response>,
  reachability: Readonly<
    Record<PlatformName, boolean>
  > = REQUIRES_INBOUND_REACHABILITY,
) => {
  const webhookHandler = vi.fn(() => handler);
  const app = new Hono();
  registerWebhookRoutes(app, {
    platform: { webhookHandler },
    reachability,
  });
  return { app, webhookHandler };
};

describe('webhookPath', () => {
  it('names the service it serves', () => {
    expect(webhookPath('teams')).toBe('/webhook/teams');
  });
});

describe('the inbound webhook', () => {
  it("returns the platform layer's own response unchanged", async () => {
    const { app } = harness(
      async () =>
        new Response(JSON.stringify({ type: 'message' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const response = await app.request(webhookPath('teams'), {
      method: 'POST',
      body: JSON.stringify({ type: 'message' }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ type: 'message' });
  });

  it('asks the platform layer for the handler of the service the path names', async () => {
    const { app, webhookHandler } = harness(async () => new Response(null));

    await app.request(webhookPath('teams'), { method: 'POST' });

    expect(webhookHandler).toHaveBeenCalledWith('teams');
  });

  it('hands the handler the request body it received', async () => {
    const seen: string[] = [];
    const { app } = harness(async (request) => {
      seen.push(await request.text());
      return new Response(null, { status: 200 });
    });

    await app.request(webhookPath('teams'), {
      method: 'POST',
      body: '{"activity":1}',
    });

    expect(seen).toEqual(['{"activity":1}']);
  });

  it('opens a route only for the services that must be reachable from outside', async () => {
    // Requirement 13.3: everything else this proxy talks to, it dials itself.
    const { app } = harness(async () => new Response(null, { status: 200 }));

    expect(
      (await app.request(webhookPath('teams'), { method: 'POST' })).status,
    ).toBe(200);
    const others = ['slack', 'discord', 'mattermost'] as const;
    const statuses = await Promise.all(
      others.map(
        async (platform) =>
          (await app.request(webhookPath(platform), { method: 'POST' })).status,
      ),
    );
    expect(statuses).toEqual(others.map(() => 404));
  });

  it('follows the reachability table it is given rather than a hard-coded service name', async () => {
    const { app } = harness(async () => new Response(null, { status: 200 }), {
      slack: true,
      discord: false,
      teams: false,
      mattermost: false,
    });

    expect(
      (await app.request(webhookPath('slack'), { method: 'POST' })).status,
    ).toBe(200);
    expect(
      (await app.request(webhookPath('teams'), { method: 'POST' })).status,
    ).toBe(404);
  });
});
