import type { PlatformName } from '@growi/chat';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { REQUIRES_INBOUND_REACHABILITY } from '../capabilities/index.js';
import {
  HEALTH_PATH,
  INBOUND_SOURCE_GUIDANCE,
  registerHealthRoutes,
} from './health-routes.js';
import { webhookPath } from './webhook-routes.js';

interface InboundExposureRow {
  readonly platform: PlatformName;
  readonly path: string;
  readonly restrictSourceTo: string;
}

interface HealthBody {
  readonly status: string;
  readonly inboundExposure: ReadonlyArray<InboundExposureRow>;
}

const readHealth = async (
  reachability: Readonly<
    Record<PlatformName, boolean>
  > = REQUIRES_INBOUND_REACHABILITY,
): Promise<{ status: number; body: HealthBody }> => {
  const app = new Hono();
  registerHealthRoutes(app, { reachability });
  const response = await app.request(HEALTH_PATH);
  return {
    status: response.status,
    body: (await response.json()) as HealthBody,
  };
};

describe('the health check', () => {
  it('answers 200 with a live status', async () => {
    const { status, body } = await readHealth();

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });
});

describe('what an operator has to let in (Requirement 13.3)', () => {
  it('lists every service that needs an inbound hole, with the path to open', async () => {
    const { body } = await readHealth();

    expect(body.inboundExposure).toEqual([
      {
        platform: 'teams',
        path: webhookPath('teams'),
        restrictSourceTo: INBOUND_SOURCE_GUIDANCE.teams,
      },
    ]);
  });

  it('tells the operator where the allowed source addresses come from', async () => {
    const { body } = await readHealth();
    const [teams] = body.inboundExposure;

    // Named as a source to look up, never as a baked-in list of addresses:
    // Microsoft publishes and changes these ranges, and a copy here would rot
    // without anything going red.
    expect(teams?.restrictSourceTo).toMatch(/AzureBotService/);
    expect(teams?.restrictSourceTo).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('reads the reachability table it is given, so a new service appears without editing this endpoint', async () => {
    const { body } = await readHealth({
      slack: false,
      discord: false,
      teams: false,
      mattermost: false,
    });

    expect(body.inboundExposure).toEqual([]);
  });

  it('says nothing about how many workspaces or GROWIs this proxy serves', async () => {
    // design.md forbids returning that count to a paired GROWI, and this
    // endpoint has no authentication of its own, so it must not carry it
    // either.
    const { body } = await readHealth();

    expect(JSON.stringify(body)).not.toMatch(/installation|relation|count/i);
  });
});

describe('INBOUND_SOURCE_GUIDANCE', () => {
  it('has guidance for every service that needs an inbound hole', () => {
    const missing = (
      Object.keys(REQUIRES_INBOUND_REACHABILITY) as PlatformName[]
    ).filter(
      (platform) =>
        REQUIRES_INBOUND_REACHABILITY[platform] &&
        (INBOUND_SOURCE_GUIDANCE[platform] ?? '') === '',
    );

    expect(missing).toEqual([]);
  });
});
