import type { RequestHandler } from 'next/dist/server/next';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import {
  listRegisteredRoutes,
  type RegisteredRoute,
} from '~/test-utils/express-route-walker';

import { getInstance } from './crowi';

const nextRequestHandlerStub: RequestHandler = () => {
  throw new Error(
    'listGrowiRoutes: the Next.js request handler is a stub for route enumeration and must not be invoked.',
  );
};

const registerAllRoutes = async (crowi: Crowi): Promise<void> => {
  // Services that route factories dereference at registration time but that
  // getInstance() does not set up.
  crowi.setupExport();
  crowi.setupImport();
  crowi.setUpGrowiBridge();
  crowi.setupG2GTransferService();

  await crowi.buildServer();
  // routes/next.ts takes the handler reference at registration time only.
  crowi.nextApp = mock<Crowi['nextApp']>({
    getRequestHandler: () => nextRequestHandlerStub,
  });
  crowi.setupRoutesForPlugins();
  await crowi.setupRoutesAtLast();
};

/**
 * apiv3 mounts most of its routers only when 'app:installed' is true at registration
 * time. Answer true for that key alone while routes are registered, instead of writing
 * the config to the per-worker database shared with other test files.
 */
const withAppInstalled = async <T>(
  crowi: Crowi,
  fn: () => Promise<T>,
): Promise<T> => {
  const { configManager } = crowi;
  const originalGetConfig = configManager.getConfig.bind(configManager);
  const spy = vi
    .spyOn(configManager, 'getConfig')
    .mockImplementation((key, source) =>
      key === 'app:installed' ? true : originalGetConfig(key, source),
    );
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
};

const bootAndList = async (): Promise<readonly RegisteredRoute[]> => {
  const crowi = await getInstance();
  await withAppInstalled(crowi, () => registerAllRoutes(crowi));
  return listRegisteredRoutes(crowi.express);
};

let routesPromise: Promise<readonly RegisteredRoute[]> | undefined;

/**
 * Register every GROWI route on the integration-test Crowi instance and list them.
 * Memoized: the apiv3 routers are module-level singletons, so registering twice in
 * one test file would duplicate every apiv3 route.
 */
export const listGrowiRoutes = (): Promise<readonly RegisteredRoute[]> => {
  routesPromise ??= bootAndList();
  return routesPromise;
};
