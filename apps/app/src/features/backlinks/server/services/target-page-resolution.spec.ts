import { Types } from 'mongoose';

import { resolveToPages } from './target-page-resolution';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  resolveRedirectEndpoints: vi.fn(),
}));

vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return {
    default: {
      ...actual.default,
      model: () => ({ find: mocks.find }),
    },
    Types: actual.Types,
  };
});

vi.mock('./redirect-endpoint-resolution', () => ({
  resolveRedirectEndpoints: mocks.resolveRedirectEndpoints,
}));

/**
 * Route each query to its docs by shape: the permalink query filters on `_id`,
 * the path query on `path`. Keys off the query rather than call order so tests
 * stay valid regardless of which branch (or both) actually runs.
 *
 * A path query returns only the requested paths, so the same `byPath` fixture
 * serves both the initial lookup and the redirect-endpoint lookup.
 */
const mockFind = (
  opts: {
    byId?: { _id: Types.ObjectId }[];
    byPath?: { _id: Types.ObjectId; path: string }[];
  } = {},
) => {
  mocks.find.mockImplementation((query) => {
    const docs =
      '_id' in query
        ? (opts.byId ?? [])
        : (opts.byPath ?? []).filter((doc) =>
            query.path.$in.includes(doc.path),
          );
    return { select: () => ({ lean: () => Promise.resolve(docs) }) };
  });
};

describe('resolveToPages()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRedirectEndpoints.mockResolvedValue(new Map());
  });

  it('resolves a regular path to its page id', async () => {
    const id = new Types.ObjectId();
    mockFind({ byPath: [{ _id: id, path: '/docs/v2' }] });

    const result = await resolveToPages(['/docs/v2']);

    expect(result.get('/docs/v2')).toBe(id);
    expect(result.size).toBe(1);
  });

  it('resolves a permalink to its page id, keyed by the original input', async () => {
    const id = new Types.ObjectId();
    mockFind({ byId: [{ _id: id }] });

    const result = await resolveToPages([`/${id.toString()}`]);

    expect(result.get(`/${id.toString()}`)).toBe(id);
    expect(result.size).toBe(1);
  });

  it('resolves permalinks and paths together in two queries', async () => {
    const permalinkId = new Types.ObjectId();
    const pathId = new Types.ObjectId();
    mockFind({
      byId: [{ _id: permalinkId }],
      byPath: [{ _id: pathId, path: '/docs/v2' }],
    });

    const result = await resolveToPages([
      `/${permalinkId.toString()}`,
      '/docs/v2',
    ]);

    expect(result.get(`/${permalinkId.toString()}`)).toBe(permalinkId);
    expect(result.get('/docs/v2')).toBe(pathId);
    expect(mocks.find).toHaveBeenCalledTimes(2);
  });

  it('omits inputs with no matching page', async () => {
    mockFind();

    const result = await resolveToPages(['/docs/v2']);

    expect(result.size).toBe(0);
  });

  it('runs no query for an empty input', async () => {
    mockFind();

    const result = await resolveToPages([]);

    expect(result.size).toBe(0);
    expect(mocks.find).not.toHaveBeenCalled();
  });

  describe('when a path has no live page', () => {
    it('resolves it through its redirect, still keyed by the input path', async () => {
      // The source body says /test; the target now lives at /test2. The stored
      // toPath must stay /test, so the key is the input, not the endpoint.
      const id = new Types.ObjectId();
      mockFind({ byPath: [{ _id: id, path: '/test2' }] });
      mocks.resolveRedirectEndpoints.mockResolvedValue(
        new Map([['/test', '/test2']]),
      );

      const result = await resolveToPages(['/test']);

      expect(result.get('/test')).toBe(id);
      expect(result.has('/test2')).toBe(false);
      expect(result.size).toBe(1);
    });

    it('leaves it unresolved when the redirect endpoint has no page either', async () => {
      // Renamed, then permanently deleted — genuinely broken.
      mockFind();
      mocks.resolveRedirectEndpoints.mockResolvedValue(
        new Map([['/test', '/test2']]),
      );

      const result = await resolveToPages(['/test']);

      expect(result.size).toBe(0);
    });

    it('leaves it unresolved when there is no redirect at all', async () => {
      mockFind();

      const result = await resolveToPages(['/never-existed']);

      expect(result.size).toBe(0);
    });

    it('follows redirects for every missed path in one extra lookup', async () => {
      const idA = new Types.ObjectId();
      const idB = new Types.ObjectId();
      mockFind({
        byPath: [
          { _id: idA, path: '/a2' },
          { _id: idB, path: '/b2' },
        ],
      });
      mocks.resolveRedirectEndpoints.mockResolvedValue(
        new Map([
          ['/a', '/a2'],
          ['/b', '/b2'],
        ]),
      );

      const result = await resolveToPages(['/a', '/b']);

      expect(result.get('/a')).toBe(idA);
      expect(result.get('/b')).toBe(idB);
      expect(mocks.resolveRedirectEndpoints).toHaveBeenCalledTimes(1);
      expect(mocks.resolveRedirectEndpoints).toHaveBeenCalledWith(['/a', '/b']);
      // One path query + one endpoint query — not one per missed path.
      expect(mocks.find).toHaveBeenCalledTimes(2);
    });
  });

  it('consults no redirects when every path resolves to a live page', async () => {
    const id = new Types.ObjectId();
    mockFind({ byPath: [{ _id: id, path: '/docs/v2' }] });

    await resolveToPages(['/docs/v2']);

    expect(mocks.resolveRedirectEndpoints).not.toHaveBeenCalled();
    expect(mocks.find).toHaveBeenCalledTimes(1);
  });

  it('consults no redirects for an unresolved permalink', async () => {
    // toPath = /{id} encodes the immutable _id, so rename can never invalidate
    // it and there is nothing to follow.
    mockFind();

    const result = await resolveToPages([
      `/${new Types.ObjectId().toString()}`,
    ]);

    expect(result.size).toBe(0);
    expect(mocks.resolveRedirectEndpoints).not.toHaveBeenCalled();
  });
});
