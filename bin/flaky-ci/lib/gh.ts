/**
 * The only entry point these scripts have to GitHub. Reads only: there is no
 * method here that writes, because every issue / label / comment / PR write
 * stays an explicit step in the procedures.
 *
 * Two constraints shape it. The cloud routine's `gh` sits behind a proxy that
 * rejects GraphQL, so only `gh api -X GET` is used — never a `gh issue` /
 * `gh pr` subcommand. And `--paginate` applies `-q` to each page separately,
 * which silently turns an aggregate into one answer per page, so pagination is
 * done here in JS instead.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type ExecResult = { readonly stdout: string };
export type ExecFn = (
  file: string,
  args: readonly string[],
) => Promise<ExecResult>;

export type GhErrorKind = 'not-installed' | 'exit-nonzero' | 'invalid-json';

export class GhError extends Error {
  readonly kind: GhErrorKind;

  constructor(kind: GhErrorKind, message: string) {
    super(message);
    this.name = 'GhError';
    this.kind = kind;
  }
}

export type GhParams = Readonly<Record<string, string | number>>;

export interface GhApi {
  get<T>(path: string, params?: GhParams): Promise<T>;
  getAll<T>(
    path: string,
    params?: GhParams,
    perPage?: number,
  ): Promise<readonly T[]>;
}

const DEFAULT_PER_PAGE = 100;

const execFileAsync = promisify(execFile);

const defaultExec: ExecFn = async (file, args) => {
  const { stdout } = await execFileAsync(file, [...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout };
};

const toArgs = (path: string, params: GhParams): readonly string[] => [
  'api',
  '-X',
  'GET',
  path,
  ...Object.entries(params).flatMap(([key, value]) => [
    '-F',
    `${key}=${value}`,
  ]),
];

const toGhError = (error: unknown): GhError => {
  const failure = error as {
    code?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  if (failure.code === 'ENOENT') {
    return new GhError('not-installed', 'gh is not installed or not on PATH');
  }
  const detail =
    typeof failure.stderr === 'string' && failure.stderr.trim() !== ''
      ? failure.stderr
      : String(failure.message ?? error);
  return new GhError('exit-nonzero', `gh api failed: ${detail}`);
};

const parseJson = (stdout: string, path: string): unknown => {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new GhError(
      'invalid-json',
      `gh api returned a response that is not JSON for ${path}`,
    );
  }
};

export const createGhApi = (exec: ExecFn = defaultExec): GhApi => {
  const request = async (path: string, params: GhParams): Promise<unknown> => {
    const result = await exec('gh', toArgs(path, params)).catch((error) => {
      throw toGhError(error);
    });
    return parseJson(result.stdout, path);
  };

  return {
    get: <T>(path: string, params: GhParams = {}): Promise<T> =>
      request(path, params) as Promise<T>,

    getAll: async <T>(
      path: string,
      params: GhParams = {},
      perPage: number = DEFAULT_PER_PAGE,
    ): Promise<readonly T[]> => {
      const items: T[] = [];
      for (let page = 1; ; page += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: the number of pages is only known from the previous page, so these requests cannot be batched.
        const body = await request(path, {
          ...params,
          per_page: perPage,
          page,
        });
        if (!Array.isArray(body)) {
          throw new GhError(
            'invalid-json',
            `gh api returned a non-array page for ${path} (page ${page})`,
          );
        }
        items.push(...(body as readonly T[]));
        if (body.length < perPage) {
          return items;
        }
      }
    },
  };
};
