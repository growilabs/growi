import type { Hono } from 'hono';

import type { Settings } from '../config/load-settings';
import type { ConversionRunner } from '../runner/conversion-runner';

export interface AppDeps {
  readonly settings: Settings;
  readonly runner: ConversionRunner;
  /** Where each request log line goes; standard error when omitted. */
  readonly writeLog?: (line: string) => void;
}

export const createApp = (_deps: AppDeps): Hono => {
  throw new Error('not implemented: http/create-app.createApp');
};
