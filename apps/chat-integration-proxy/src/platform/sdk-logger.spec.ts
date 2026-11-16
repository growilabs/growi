import { createSdkLogger } from './sdk-logger.js';

// Shaped like the HTTP client failures the adapters log as `{ error }`: the
// message is harmless, the request the error carries is not.
const failedRequest = (): Error =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
    name: 'AxiosError',
    stack: [
      'AxiosError: connect ECONNREFUSED 127.0.0.1:1',
      '    at settle (/app/node_modules/axios/index.js:10:5)',
    ].join('\n'),
    config: { headers: { Authorization: 'Bearer xoxb-LEAK-TEST' } },
    request: { _header: 'Authorization: Bearer xoxb-LEAK-TEST\r\n' },
  });

const FAILED_REQUEST_LINE_TAIL =
  '(AxiosError: connect ECONNREFUSED 127.0.0.1:1) | at settle (/app/node_modules/axios/index.js:10:5)';

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
      `[chat-sdk] Message processing error ${FAILED_REQUEST_LINE_TAIL}`,
      `[chat-sdk] Could not acquire lock on thread ${FAILED_REQUEST_LINE_TAIL}`,
    ]);
  });

  it('names a failure the SDK already turned into a string, as the Discord Gateway listener does', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));

    logger.error('Discord Gateway listener error', {
      error: 'Error [TokenInvalid]: An invalid token was provided.',
    });

    expect(lines).toEqual([
      '[chat-sdk] Discord Gateway listener error (Error [TokenInvalid]: An invalid token was provided.)',
    ]);
  });

  it('keeps a failure on one bounded line however long or multi-line its text is', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));

    logger.error('Slack socket mode listener error', {
      error: `Error: first\nsecond\r\n${'x'.repeat(2000)}`,
    });
    const longMessage = `first\nsecond\r\n${'y'.repeat(2000)}`;
    logger.error(
      'Message processing error',
      Object.assign(new Error(longMessage), {
        stack: `Error: ${longMessage}`,
      }),
    );

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(line).toContain('first second ');
      expect(line.length).toBeLessThan(1000);
    }
  });

  it('adds where the failure was thrown -- at most five call sites, never the lines of a multi-line message', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));
    const frames = Array.from(
      { length: 7 },
      (_, i) => `    at step${i} (/app/dist/step${i}.js:${i + 1}:1)`,
    );
    const thrown = Object.assign(new TypeError('boom\ncontinued'), {
      stack: ['TypeError: boom', 'continued', ...frames].join('\n'),
    });

    logger.error('Message processing error', { error: thrown });

    expect(lines).toEqual([
      `[chat-sdk] Message processing error (TypeError: boom continued) | ${frames
        .slice(0, 5)
        .map((frame) => frame.trim())
        .join(' | ')}`,
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

describe('createSdkLogger never throws into the SDK', () => {
  // The SDK calls its logger inside a promise's `.catch`; a throw there is an
  // unhandled rejection, which ends the process under Node's defaults.
  it('reports the SDK message alone when the error cannot be read', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));
    const unreadable = new Error('unused');
    Object.defineProperty(unreadable, 'message', {
      get: () => {
        throw new Error('message getter failed');
      },
    });

    expect(() =>
      logger.error('Message processing error', { error: unreadable }),
    ).not.toThrow();
    expect(lines).toEqual(['[chat-sdk] Message processing error']);
  });

  it('reports the SDK message alone when the context object cannot be inspected', () => {
    const lines: string[] = [];
    const logger = createSdkLogger((line) => lines.push(line));
    const hostile = new Proxy(
      {},
      {
        has: () => {
          throw new Error('has trap failed');
        },
      },
    );

    expect(() =>
      logger.warn('Could not fetch user info', hostile),
    ).not.toThrow();
    expect(lines).toEqual(['[chat-sdk] Could not fetch user info']);
  });

  it('swallows a failure of the reporter itself', () => {
    const logger = createSdkLogger(() => {
      throw new Error('reporter failed');
    });

    expect(() =>
      logger.error('Message processing error', { error: failedRequest() }),
    ).not.toThrow();
    expect(() => logger.warn('Could not acquire lock on thread')).not.toThrow();
  });
});
