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

export type GrowiAppHooks = {
  /** Runs before the global middlewares are built (e.g. to provide a session config). */
  readonly beforeServer?: (crowi: Crowi) => void | Promise<void>;
  /** Runs after the global middlewares (session, passport) and before any route. */
  readonly beforeRoutes?: (crowi: Crowi) => void | Promise<void>;
};

const registerAllRoutes = async (
  crowi: Crowi,
  hooks: GrowiAppHooks,
): Promise<void> => {
  // Services that route factories dereference at registration time but that
  // getInstance() does not set up.
  crowi.setupExport();
  crowi.setupImport();
  crowi.setUpGrowiBridge();
  crowi.setupG2GTransferService();

  await hooks.beforeServer?.(crowi);
  await crowi.buildServer();
  // routes/next.ts takes the handler reference at registration time only.
  crowi.nextApp = mock<Crowi['nextApp']>({
    getRequestHandler: () => nextRequestHandlerStub,
  });
  await hooks.beforeRoutes?.(crowi);
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

/**
 * Register every GROWI route on the integration-test Crowi instance and return it,
 * so requests can go through `crowi.express` with the production middleware order.
 * Call it once per test file (the apiv3 routers are module-level singletons), and not
 * together with listGrowiRoutes in the same file.
 */
export const bootGrowiApp = async (
  hooks: GrowiAppHooks = {},
): Promise<Crowi> => {
  const crowi = await getInstance();
  await withAppInstalled(crowi, () => registerAllRoutes(crowi, hooks));
  return crowi;
};

const bootAndList = async (): Promise<readonly RegisteredRoute[]> => {
  const crowi = await bootGrowiApp();
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
