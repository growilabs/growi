import { randomBytes } from 'node:crypto';

import { createLeveledLog } from '../../config/leveled-log';
import { loadSettings } from '../../config/load-settings';
import {
  type ConversionRunner,
  type ConversionRunnerOptions,
  createConversionRunner,
  runnerOptionsFromSettings,
} from '../../runner/conversion-runner';
import { createApp, startServer } from '..';
import { type HostPort, hostPortOf } from './raw-http';

// The HTTP layer as production wires it (createApp + startServer), on a port
// the OS picks, with the settings read from `env` the way main.ts reads them
// (no process.env) and every request log line collected.

export interface TestService {
  readonly url: string;
  readonly address: HostPort;
  readonly token: string;
  /** The log lines written so far, in order. */
  readonly logs: readonly string[];
  close(): Promise<void>;
}

export const startTestService = async (
  runner: ConversionRunner,
  env: Readonly<Record<string, string>> = {},
  /** Give the array a real runner already writes to, to see both in one log. */
  logs: string[] = [],
): Promise<TestService> => {
  const token = `spec-token-${randomBytes(8).toString('hex')}`;
  const settings = loadSettings({
    ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: token,
    ...env,
  });
  const app = createApp({
    settings,
    runner,
    writeLog: (line) => logs.push(line),
  });
  const server = await startServer(app, { port: 0, hostname: '127.0.0.1' });
  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    address: hostPortOf(url),
    token,
    logs,
    close: () => server.close(),
  };
};

/**
 * Starts a service before each test of the file and stops it after: a test
 * that changes the runner or the settings gets its own through `restart`.
 */
export const useTestService = (
  setup: () => {
    readonly runner: ConversionRunner;
    readonly env?: Readonly<Record<string, string>>;
  },
): {
  readonly current: () => TestService;
  readonly restart: (
    runner: ConversionRunner,
    env?: Readonly<Record<string, string>>,
  ) => Promise<TestService>;
} => {
  let service: TestService | undefined;
  beforeEach(async () => {
    const { runner, env } = setup();
    service = await startTestService(runner, env);
  });
  afterEach(async () => {
    await service?.close();
    service = undefined;
  });
  return {
    current: () => {
      if (service === undefined)
        throw new Error('the test service has not started');
      return service;
    },
    restart: async (runner, env) => {
      await service?.close();
      service = await startTestService(runner, env);
      return service;
    },
  };
};

/**
 * The real runner for the settings `env` gives (the same ones the service
 * gets), with single options replaced: a stand-in child entry, a sub-second
 * deadline (TIMEOUT_S is an integer). With `logs`, its diagnostic lines go
 * there, at the LOG_LEVEL of `env`, as service.ts wires them.
 */
export const realRunner = (
  env: Readonly<Record<string, string>> = {},
  overrides: Partial<ConversionRunnerOptions> = {},
  logs?: string[],
): ConversionRunner => {
  const settings = loadSettings({
    ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: 'runner-only',
    ...env,
  });
  const options = { ...runnerOptionsFromSettings(settings), ...overrides };
  return logs === undefined
    ? createConversionRunner(options)
    : createConversionRunner(
        options,
        createLeveledLog(settings.logLevel, (line) => logs.push(line)),
      );
};
