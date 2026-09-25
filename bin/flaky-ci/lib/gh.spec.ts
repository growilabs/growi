import { describe, expect, it, vi } from 'vitest';

import { createGhApi, type ExecFn, GhError } from './gh.ts';

type Call = { readonly file: string; readonly args: readonly string[] };

const recordingExec = (
  respond: (call: Call) => Promise<{ stdout: string }>,
): { exec: ExecFn; calls: Call[] } => {
  const calls: Call[] = [];
  const exec: ExecFn = (file, args) => {
    const call = { file, args };
    calls.push(call);
    return respond(call);
  };
  return { exec, calls };
};

const pageOf = (args: readonly string[]): string | undefined =>
  args.find((arg) => arg.startsWith('page='))?.slice('page='.length);

describe('gh.get', () => {
  it('calls `gh api -X GET` with the path and the named parameters', async () => {
    const { exec, calls } = recordingExec(async () => ({ stdout: '{"id":1}' }));
    const api = createGhApi(exec);

    await api.get('repos/growilabs/growi/issues/11900', { state: 'open' });

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('gh');
    expect(calls[0].args).toEqual([
      'api',
      '-X',
      'GET',
      'repos/growilabs/growi/issues/11900',
      '-F',
      'state=open',
    ]);
  });

  it('never asks gh to paginate or to filter with -q', async () => {
    const { exec, calls } = recordingExec(async () => ({ stdout: '[]' }));
    const api = createGhApi(exec);

    await api.get('repos/growilabs/growi/issues');

    expect(calls[0].args).not.toContain('--paginate');
    expect(calls[0].args).not.toContain('-q');
  });

  it('returns the parsed response', async () => {
    const { exec } = recordingExec(async () => ({
      stdout: '{"number":11900,"state":"open"}',
    }));
    const api = createGhApi(exec);

    await expect(
      api.get('repos/growilabs/growi/issues/11900'),
    ).resolves.toEqual({ number: 11900, state: 'open' });
  });

  it('reports a missing gh as not-installed', async () => {
    const { exec } = recordingExec(() =>
      Promise.reject(
        Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }),
      ),
    );
    const api = createGhApi(exec);

    const error = await api.get('repos/growilabs/growi/issues').catch((e) => e);
    expect(error).toBeInstanceOf(GhError);
    expect((error as GhError).kind).toBe('not-installed');
  });

  it('reports a non-zero exit distinctly from a missing gh', async () => {
    const { exec } = recordingExec(() =>
      Promise.reject(
        Object.assign(new Error('Command failed'), {
          code: 1,
          stderr: 'gh: Not Found (HTTP 404)',
        }),
      ),
    );
    const api = createGhApi(exec);

    const error = await api.get('repos/growilabs/growi/issues').catch((e) => e);
    expect(error).toBeInstanceOf(GhError);
    expect((error as GhError).kind).toBe('exit-nonzero');
    expect((error as GhError).message).toContain('Not Found');
  });

  it('reports a response that is not JSON as invalid-json', async () => {
    const { exec } = recordingExec(async () => ({
      stdout: 'gh: could not read the response',
    }));
    const api = createGhApi(exec);

    const error = await api.get('repos/growilabs/growi/issues').catch((e) => e);
    expect(error).toBeInstanceOf(GhError);
    expect((error as GhError).kind).toBe('invalid-json');
  });
});

describe('gh.getAll', () => {
  it('walks the pages itself and stops on the first short page', async () => {
    const pages: Record<string, string> = {
      '1': '[{"id":1},{"id":2}]',
      '2': '[{"id":3}]',
    };
    const { exec, calls } = recordingExec(async ({ args }) => ({
      stdout: pages[pageOf(args) ?? '1'] ?? '[]',
    }));
    const api = createGhApi(exec);

    const items = await api.getAll<{ id: number }>(
      'repos/growilabs/growi/issues',
      { state: 'open' },
      2,
    );

    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls.map(({ args }) => pageOf(args))).toEqual(['1', '2']);
    expect(calls[0].args).toEqual([
      'api',
      '-X',
      'GET',
      'repos/growilabs/growi/issues',
      '-F',
      'state=open',
      '-F',
      'per_page=2',
      '-F',
      'page=1',
    ]);
  });

  it('stops on an empty page that lands exactly on the page size', async () => {
    const pages: Record<string, string> = {
      '1': '[{"id":1},{"id":2}]',
      '2': '[]',
    };
    const { exec, calls } = recordingExec(async ({ args }) => ({
      stdout: pages[pageOf(args) ?? '1'] ?? '[]',
    }));
    const api = createGhApi(exec);

    const items = await api.getAll<{ id: number }>(
      'repos/growilabs/growi/issues',
      undefined,
      2,
    );

    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls.map(({ args }) => pageOf(args))).toEqual(['1', '2']);
  });

  it('returns an empty list, as a success, when the first page is empty', async () => {
    const { exec, calls } = recordingExec(async () => ({ stdout: '[]' }));
    const api = createGhApi(exec);

    await expect(api.getAll('repos/growilabs/growi/issues')).resolves.toEqual(
      [],
    );
    expect(calls).toHaveLength(1);
  });

  it('never asks gh to paginate', async () => {
    const { exec, calls } = recordingExec(async () => ({ stdout: '[]' }));
    const api = createGhApi(exec);

    await api.getAll('repos/growilabs/growi/issues');

    expect(calls[0].args).not.toContain('--paginate');
  });

  it('reports a page that is not an array as invalid-json', async () => {
    const { exec } = recordingExec(async () => ({ stdout: '{"message":"x"}' }));
    const api = createGhApi(exec);

    const error = await api
      .getAll('repos/growilabs/growi/issues')
      .catch((e) => e);
    expect(error).toBeInstanceOf(GhError);
    expect((error as GhError).kind).toBe('invalid-json');
  });

  it('passes a failure on the second page through as a GhError', async () => {
    const exec = vi
      .fn<ExecFn>()
      .mockResolvedValueOnce({ stdout: '[{"id":1}]' })
      .mockRejectedValueOnce(
        Object.assign(new Error('Command failed'), { code: 1, stderr: 'boom' }),
      );
    const api = createGhApi(exec);

    const error = await api
      .getAll('repos/growilabs/growi/issues', undefined, 1)
      .catch((e) => e);
    expect(error).toBeInstanceOf(GhError);
    expect((error as GhError).kind).toBe('exit-nonzero');
  });
});
