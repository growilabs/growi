import { parseArgs } from 'node:util';

export interface RunOptions {
  readonly serviceUrl: string;
  readonly token: string;
  /** Names the measured service in the report, e.g. `python` or `node`. */
  readonly label: string;
  readonly jsonPath?: string;
  readonly esUrl?: string;
  readonly timeoutMs: number;
}

export const RUN_USAGE = `Usage: pnpm benchmark --url <service URL> --label <name> [options]

  --url <url>          extraction service base URL (or BENCHMARK_URL)
  --label <name>       names the service in the report, e.g. python / node
  --token-file <path>  file holding the Bearer token (or BENCHMARK_TOKEN)
  --json <path>        also write the full report as JSON
  --es-url <url>       Elasticsearch for the search recall stage (or BENCHMARK_ES_URL)
  --timeout-ms <n>     per-document request timeout (default 120000)

The token is never taken as an argument, so that it stays out of ps and the
shell history.`;

const DEFAULT_TIMEOUT_MS = 120_000;

const required = (value: string | undefined, problem: string): string => {
  if (value == null || value === '') {
    throw new Error(problem);
  }
  return value;
};

// fetch refuses a URL with credentials and quotes the whole URL in its
// error, which would carry them into the report; so they are refused here,
// without repeating the URL.
const plainUrl = (value: string, name: string): string => {
  const parsed = URL.parse(value);
  if (parsed == null) {
    throw new Error(`${name} is not a valid URL`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error(`${name} must not hold a user name or password`);
  }
  return value;
};

const positiveInteger = (value: string | undefined): number => {
  if (value == null) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  return parsed;
};

/** Reads the CLI arguments and environment; throws naming what is wrong. */
export const parseRunOptions = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  readTextFile: (path: string) => string,
): RunOptions => {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      url: { type: 'string' },
      label: { type: 'string' },
      'token-file': { type: 'string' },
      json: { type: 'string' },
      'es-url': { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
  });
  const tokenFile = values['token-file'];
  const token =
    tokenFile == null ? env.BENCHMARK_TOKEN : readTextFile(tokenFile).trim();
  const esUrl = values['es-url'] ?? env.BENCHMARK_ES_URL;
  return {
    serviceUrl: plainUrl(
      required(
        values.url ?? env.BENCHMARK_URL,
        'the service URL is missing: pass --url or set BENCHMARK_URL',
      ),
      'the service URL (--url / BENCHMARK_URL)',
    ),
    token: required(
      token,
      'the token is missing: set BENCHMARK_TOKEN or pass --token-file',
    ),
    label: required(values.label, 'the label is missing: pass --label'),
    ...(values.json == null ? {} : { jsonPath: values.json }),
    ...(esUrl == null || esUrl === ''
      ? {}
      : {
          esUrl: plainUrl(
            esUrl,
            'the Elasticsearch URL (--es-url / BENCHMARK_ES_URL)',
          ),
        }),
    timeoutMs: positiveInteger(values['timeout-ms']),
  };
};
