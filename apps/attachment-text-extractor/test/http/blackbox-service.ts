import { randomBytes } from 'node:crypto';

import {
  type HostPort,
  hostPortOf,
} from '../../src/http/spec-support/raw-http';

// The service the black-box tests talk to (research.md 22.2):
// - BLACKBOX_URL (+ BLACKBOX_TOKEN): a running service, the Python one included;
// - otherwise the Node service, started in this process with the default settings.

export interface BlackboxService {
  readonly url: string;
  readonly token: string;
  readonly address: HostPort;
  close(): Promise<void>;
}

const TOKEN_NAME = 'ATTACHMENT_EXTRACTOR_SERVICE_TOKEN';

// Imported only when the Node service is started here: pointed at another
// service, these tests must not need src/ at all.
const startNodeService = async (): Promise<BlackboxService> => {
  const [{ loadSettings }, runnerModule, { createApp, startServer }] =
    await Promise.all([
      import('../../src/config/load-settings'),
      import('../../src/runner/conversion-runner'),
      import('../../src/http'),
    ]);
  const token = `blackbox-${randomBytes(12).toString('hex')}`;
  const settings = loadSettings({ [TOKEN_NAME]: token });
  const runner = runnerModule.createConversionRunner(
    runnerModule.runnerOptionsFromSettings(settings),
  );
  const app = createApp({ settings, runner, writeLog: () => {} });
  const server = await startServer(app, { port: 0, hostname: '127.0.0.1' });
  const url = `http://127.0.0.1:${server.port}`;
  return { url, token, address: hostPortOf(url), close: () => server.close() };
};

export const startBlackboxService = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<BlackboxService> => {
  const url = (env.BLACKBOX_URL ?? '').replace(/\/+$/, '');
  if (url === '') {
    return startNodeService();
  }
  const token = env.BLACKBOX_TOKEN ?? '';
  if (token === '') {
    return Promise.reject(new Error('BLACKBOX_URL needs BLACKBOX_TOKEN'));
  }
  return Promise.resolve({
    url,
    token,
    address: hostPortOf(url),
    close: () => Promise.resolve(),
  });
};

/**
 * Starts the service before the file's tests and stops it after them. The
 * returned getter is read inside each test.
 */
export const useBlackboxService = (): (() => BlackboxService) => {
  let service: BlackboxService | undefined;
  beforeAll(async () => {
    service = await startBlackboxService();
  }, 60_000);
  afterAll(async () => {
    await service?.close();
  });
  return () => {
    if (service === undefined) {
      throw new Error('the black-box service has not started');
    }
    return service;
  };
};
