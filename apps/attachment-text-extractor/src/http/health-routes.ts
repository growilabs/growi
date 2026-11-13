import type { Hono } from 'hono';
import { describeResponse } from 'hono-openapi';

import type { ConversionRunner } from '../runner';
import { HealthSchema, NotReadySchema, ReadySchema } from './api-schemas';
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
} as const);

const isReady = async (runner: ConversionRunner): Promise<boolean> => {
  try {
    return (await runner.readiness()).ready;
  } catch {
    return false;
  }
};

const json = <T>(description: string, vSchema: T) => ({
  description,
  content: { 'application/json': { vSchema } },
});

// describeResponse checks what each handler passes to c.json against the
// documented schema at compile time.
export const registerHealthRoutes = (
  app: Hono<AppEnv>,
  runner: ConversionRunner,
): void => {
  app.get(
    '/healthz',
    describeResponse((c) => c.json({ status: 'ok' } as const, 200), {
      200: json('OK', HealthSchema),
    }),
  );
  // Asked afresh every time: a pod that was not ready can come back.
  app.get(
    '/readyz',
    describeResponse(
      async (c) =>
        (await isReady(runner))
          ? c.json(
              { status: 'ready', dependencies: READY_DEPENDENCIES } as const,
              200,
            )
          : c.json({ status: 'not_ready' } as const, 503),
      {
        200: json('OK', ReadySchema),
        503: json('Not ready', NotReadySchema),
      },
    ),
  );
};
