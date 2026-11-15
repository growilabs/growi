import { createSdkLogger } from './sdk-logger.js';

// Shaped like the HTTP client failures the adapters log as `{ error }`: the
// message is harmless, the request the error carries is not.
const failedRequest = (): Error =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
    name: 'AxiosError',
    config: { headers: { Authorization: 'Bearer xoxb-LEAK-TEST' } },
    request: { _header: 'Authorization: Bearer xoxb-LEAK-TEST\r\n' },
  });

const captureProcessOutput = (): { readonly written: () => string } => {
  const chunks: string[] = [];
  const keep = (...args: unknown[]): void => {
    chunks.push(args.map((arg) => String(arg)).join(' '));
  };
  for (const method of ['error', 'warn', 'info', 'log', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(keep);
  }
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    keep(chunk);
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    keep(chunk);
    return true;
  });
  return { written: () => chunks.join('\n') };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSdkLogger without a reporter', () => {
  it('writes nothing at any level, from itself or from its children', () => {
    const output = captureProcessOutput();
    const logger = createSdkLogger();

    for (const target of [logger, logger.child('teams').child('graph')]) {
      target.error('Teams Graph API: fetchMessages error', {
        error: failedRequest(),
      });
      target.warn('Could not fetch user info', { error: failedRequest() });
      target.info('connected');
      target.debug('raw body', { body: 'xoxb-LEAK-TEST' });
    }

    expect(output.written()).toBe('');
  });
});

describe('createSdkLogger with a reporter', () => {
  it('reports an error or a warning as one line naming the failure, without the request it carried', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));

    logger.error('Message processing error', {
      error: failedRequest(),
      threadId: 'slack:C1:1.2',
    });
    logger.warn('Could not acquire lock on thread', failedRequest());

    expect(lines).toEqual([
      '[chat-sdk] Message processing error (AxiosError: connect ECONNREFUSED 127.0.0.1:1)',
      '[chat-sdk] Could not acquire lock on thread (AxiosError: connect ECONNREFUSED 127.0.0.1:1)',
    ]);
  });

  it('names the service a child logger speaks for', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));

    logger.child('mattermost').error('WebSocket error');

    expect(lines).toEqual(['[chat-sdk:mattermost] WebSocket error']);
  });

  it('reports nothing below a warning, since the SDK logs request bodies there', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));

    logger.info('Chat instance initialized');
    logger.debug('Teams webhook raw body', { body: 'xoxb-LEAK-TEST' });

    expect(lines).toEqual([]);
  });
});
