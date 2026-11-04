import express from 'express';
import request from 'supertest';
import { mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { type ContributorSection, contributors } from './contributors';

// --- Mock boundary ---------------------------------------------------------
//
// The observable contract of GET /staffs is the JSON body it returns:
//   - no GROWI.cloud configured -> the built-in contributor list, untouched
//   - GROWI.cloud configured     -> built-in + the fetched section, order-sorted
//   - GROWI.cloud fetch fails     -> still 200 with the built-in list (logged warn)
//   - the GROWI.cloud section is merged once and cached for an hour
//
// axios is the external boundary (the GROWI.cloud HTTP call) and is mocked.
// The module keeps its merge result in module scope, so each test rebuilds the
// app on a fresh module (vi.resetModules) to stay isolated.
const axiosMocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('~/utils/axios', () => ({
  default: { get: axiosMocks.get },
}));

const buildApp = async (growiCloudUri: string | undefined) => {
  vi.resetModules();
  const { setup } = await import('./index');

  const crowi = mockDeep<Crowi>();
  crowi.configManager.getConfig.mockReturnValue(growiCloudUri);

  const app = express();
  app.use((_req, res, next) => {
    // Inject the apiv3 responder normally added by addCustomFunctionToResponse
    Object.assign(res, { apiv3: (obj: unknown) => res.json(obj) });
    next();
  });
  app.use('/', setup(crowi));
  return app;
};

const CLOUD_SECTION: ContributorSection = {
  order: 5,
  sectionName: 'GROWI.cloud',
  additionalClass: '',
  memberGroups: [],
};

beforeEach(() => {
  axiosMocks.get.mockReset();
});

describe('GET /staffs', () => {
  it('returns the built-in contributor list and skips GROWI.cloud when it is not configured', async () => {
    const app = await buildApp(undefined);

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.contributors).toEqual(contributors);
    expect(axiosMocks.get).not.toHaveBeenCalled();
  });

  it('merges the GROWI.cloud section into the list and keeps it order-sorted', async () => {
    axiosMocks.get.mockResolvedValue({ data: CLOUD_SECTION });
    const app = await buildApp('https://cloud.example.com');

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(axiosMocks.get).toHaveBeenCalledWith(
      'https://cloud.example.com/_api/staffCredit',
    );
    // The cloud section (order 5) is spliced between the built-in orders 1 and 10
    const orders = res.body.contributors.map(
      (s: ContributorSection) => s.order,
    );
    expect(orders).toEqual([1, 5, 10, 100, 200]);
  });

  it('still returns 200 with the built-in list when the GROWI.cloud fetch fails', async () => {
    axiosMocks.get.mockRejectedValue(new Error('network down'));
    const app = await buildApp('https://cloud.example.com');

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.contributors).toEqual(contributors);
  });

  it('merges the GROWI.cloud section only once and caches it across requests', async () => {
    axiosMocks.get.mockResolvedValue({ data: CLOUD_SECTION });
    const app = await buildApp('https://cloud.example.com');

    await request(app).get('/');
    const res = await request(app).get('/');

    const cloudSections = res.body.contributors.filter(
      (s: ContributorSection) => s.sectionName === 'GROWI.cloud',
    );
    expect(cloudSections).toHaveLength(1);
    // The 1-hour cache means the second request does not re-fetch
    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
  });
});
