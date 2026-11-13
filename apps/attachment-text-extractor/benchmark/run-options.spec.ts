import { parseRunOptions } from './run-options';

const noFile = (path: string): string => {
  throw new Error(`unexpected read of ${path}`);
};

describe('parseRunOptions', () => {
  it('takes the service URL and label from arguments and the token from BENCHMARK_TOKEN', () => {
    expect(
      parseRunOptions(
        ['--url', 'http://127.0.0.1:18000', '--label', 'python'],
        { BENCHMARK_TOKEN: 'secret' },
        noFile,
      ),
    ).toEqual({
      serviceUrl: 'http://127.0.0.1:18000',
      token: 'secret',
      label: 'python',
      timeoutMs: 120_000,
    });
  });

  it('takes the service URL and Elasticsearch URL from the environment when no argument names them', () => {
    expect(
      parseRunOptions(
        ['--label', 'node', '--json', 'out.json', '--timeout-ms', '5000'],
        {
          BENCHMARK_URL: 'http://127.0.0.1:18001',
          BENCHMARK_TOKEN: 'secret',
          BENCHMARK_ES_URL: 'http://elasticsearch:9200',
        },
        noFile,
      ),
    ).toEqual({
      serviceUrl: 'http://127.0.0.1:18001',
      token: 'secret',
      label: 'node',
      jsonPath: 'out.json',
      esUrl: 'http://elasticsearch:9200',
      timeoutMs: 5000,
    });
  });

  it('reads the token from --token-file, without the surrounding newline', () => {
    const options = parseRunOptions(
      ['--url', 'http://x', '--label', 'python', '--token-file', '/tmp/t'],
      {},
      (path) => (path === '/tmp/t' ? 'from-file\n' : noFile(path)),
    );

    expect(options.token).toBe('from-file');
  });

  it('prefers --es-url over BENCHMARK_ES_URL', () => {
    const options = parseRunOptions(
      ['--url', 'http://x', '--label', 'l', '--es-url', 'http://a:9200'],
      { BENCHMARK_TOKEN: 't', BENCHMARK_ES_URL: 'http://b:9200' },
      noFile,
    );

    expect(options.esUrl).toBe('http://a:9200');
  });

  it.each<[string, string[], Record<string, string>, RegExp]>([
    ['no service URL', ['--label', 'l'], { BENCHMARK_TOKEN: 't' }, /--url/],
    ['no token', ['--url', 'http://x', '--label', 'l'], {}, /BENCHMARK_TOKEN/],
    ['no label', ['--url', 'http://x'], { BENCHMARK_TOKEN: 't' }, /--label/],
    [
      'a timeout that is not a positive integer',
      ['--url', 'http://x', '--label', 'l', '--timeout-ms', '0'],
      { BENCHMARK_TOKEN: 't' },
      /--timeout-ms/,
    ],
    // A token on the command line would show in ps and the shell history.
    [
      'a token given as an argument',
      ['--url', 'http://x', '--label', 'l', '--token', 't'],
      {},
      /token/,
    ],
  ])('rejects %s', (_case, argv, env, message) => {
    expect(() => parseRunOptions(argv, env, noFile)).toThrow(message);
  });

  // fetch rejects a URL with credentials and quotes the URL in its error,
  // which would carry them into the report.
  it.each<[string, string[], Record<string, string>]>([
    [
      '--url',
      ['--url', 'http://u:secretA@127.0.0.1:18000', '--label', 'l'],
      { BENCHMARK_TOKEN: 't' },
    ],
    [
      'BENCHMARK_URL',
      ['--label', 'l'],
      {
        BENCHMARK_TOKEN: 't',
        BENCHMARK_URL: 'http://u:secretA@127.0.0.1:18000',
      },
    ],
    [
      '--es-url',
      [
        '--url',
        'http://x',
        '--label',
        'l',
        '--es-url',
        'http://u:secretA@es:9200',
      ],
      { BENCHMARK_TOKEN: 't' },
    ],
    [
      'BENCHMARK_ES_URL',
      ['--url', 'http://x', '--label', 'l'],
      { BENCHMARK_TOKEN: 't', BENCHMARK_ES_URL: 'http://secretA@es:9200' },
    ],
  ])('rejects credentials in the URL from %s, without repeating them', (_source, argv, env) => {
    expect(() => parseRunOptions(argv, env, noFile)).toThrow(
      /user name or password/,
    );
    expect(() => parseRunOptions(argv, env, noFile)).not.toThrow(/secretA/);
  });

  it('rejects a URL it cannot parse, without repeating it', () => {
    const argv = ['--url', 'not a url secretB', '--label', 'l'];

    expect(() =>
      parseRunOptions(argv, { BENCHMARK_TOKEN: 't' }, noFile),
    ).toThrow(/not a valid URL/);
    expect(() =>
      parseRunOptions(argv, { BENCHMARK_TOKEN: 't' }, noFile),
    ).not.toThrow(/secretB/);
  });
});
