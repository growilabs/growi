import { resolveRedirectEndpoints } from './redirect-endpoint-resolution';

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
}));

vi.mock('~/server/models/page-redirect', () => ({
  default: { aggregate: mocks.aggregate },
}));

type Hop = { fromPath: string; toPath: string; depth: number };

/**
 * Return only the docs the pipeline actually asked for, so a `$match` that drops
 * inputs shows up as an unresolved path rather than passing silently. A pipeline
 * with no `$match` matches nothing — the safe direction to fail in.
 */
const mockRedirects = (
  docs: { fromPath: string; toPath: string; chains?: Hop[] }[],
) => {
  mocks.aggregate.mockImplementation((pipeline) => {
    const match = pipeline.find((stage) => '$match' in stage)?.$match;
    const wanted: string[] = match?.fromPath?.$in ?? [];
    return Promise.resolve(
      docs
        .filter((doc) => wanted.includes(doc.fromPath))
        .map((doc) => ({ chains: [], ...doc })),
    );
  });
};

describe('resolveRedirectEndpoints()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('maps a single-hop redirect to its target path', async () => {
    mockRedirects([{ fromPath: '/test', toPath: '/test2' }]);

    const result = await resolveRedirectEndpoints(['/test']);

    expect(result.get('/test')).toBe('/test2');
    expect(result.size).toBe(1);
  });

  it('picks the deepest hop regardless of the order chains are returned in', async () => {
    // $graphLookup makes no ordering guarantee, so depth must decide which hop
    // ends the chain. Unit-only: the ordering cannot be forced against a real DB,
    // which is why multi-hop chains are otherwise covered in the integ spec.
    mockRedirects([
      {
        fromPath: '/a',
        toPath: '/b',
        chains: [
          { fromPath: '/c', toPath: '/d', depth: 1 },
          { fromPath: '/b', toPath: '/c', depth: 0 },
        ],
      },
    ]);

    const result = await resolveRedirectEndpoints(['/a']);

    expect(result.get('/a')).toBe('/d');
  });

  it('omits a path that has no redirect document', async () => {
    mockRedirects([{ fromPath: '/renamed', toPath: '/renamed2' }]);

    const result = await resolveRedirectEndpoints([
      '/renamed',
      '/never-existed',
    ]);

    expect(result.has('/never-existed')).toBe(false);
    expect(result.size).toBe(1);
  });

  it('resolves every input path in a single aggregation', async () => {
    mockRedirects([
      { fromPath: '/a', toPath: '/a2' },
      { fromPath: '/b', toPath: '/b2' },
    ]);

    const result = await resolveRedirectEndpoints(['/a', '/b']);

    expect(result.get('/a')).toBe('/a2');
    expect(result.get('/b')).toBe('/b2');
    expect(mocks.aggregate).toHaveBeenCalledTimes(1);
  });

  it('runs no aggregation for an empty input', async () => {
    const result = await resolveRedirectEndpoints([]);

    expect(result.size).toBe(0);
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });
});
