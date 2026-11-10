import type { Hono } from 'hono';

import type { ConversionRunner } from '../runner';
import type { AppEnv } from './app-env';

// D2: the packages a ready probe child has loaded, prlimit, and the service's
// own modules as one "converter" entry (this path needs no token, so internal
// names stay out). Readiness carries only `ready` (research.md 27.6), so a
// not-ready answer names no component: it would claim a per-component check
// that was never made.
const READY_DEPENDENCIES = Object.freeze({
  '@firecrawl/anydoc': 'ok',
  '@embedpdf/pdfium': 'ok',
  prlimit: 'ok',
  converter: 'ok',
});

const isReady = async (runner: ConversionRunner): Promise<boolean> => {
  try {
    return (await runner.readiness()).ready;
  } catch {
    return false;
  }
};

export const registerHealthRoutes = (
  app: Hono<AppEnv>,
  runner: ConversionRunner,
): void => {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  // Asked afresh every time: a pod that was not ready can come back.
  app.get('/readyz', async (c) =>
    (await isReady(runner))
      ? c.json({ status: 'ready', dependencies: READY_DEPENDENCIES })
      : c.json({ status: 'not_ready' }, 503),
  );
};
