import { Types } from 'mongoose';

import { resolveToPages } from './target-page-resolution';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
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

/**
 * Route each query to its docs by shape: the permalink query filters on `_id`,
 * the path query on `path`. Keys off the query rather than call order so tests
 * stay valid regardless of which branch (or both) actually runs.
 */
const mockFind = (opts: { byId?: unknown[]; byPath?: unknown[] } = {}) => {
  mocks.find.mockImplementation((query) => {
    const docs = '_id' in query ? (opts.byId ?? []) : (opts.byPath ?? []);
    return { select: () => Promise.resolve(docs) };
  });
};

describe('resolveToPages()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
});
