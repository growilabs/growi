import { resolveToPage } from './target-page-resolution';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByPath: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: {
    model: () => ({
      findById: mocks.findById,
      findByPath: mocks.findByPath,
    }),
  },
}));

describe('resolveToPage()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves page id from path', async () => {
    mocks.findByPath.mockResolvedValue({ _id: 'path-hit', path: '/docs/v2' });

    const id = await resolveToPage('/docs/v2');

    expect(id).toBe('path-hit');
    // path branch must not touch the permalink lookup
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('resolves page id from permalink path', async () => {
    mocks.findById.mockResolvedValue({
      _id: 'permalink-hit',
      path: '/6a4c8be9b698d2b7ab35cd6e',
    });

    const id = await resolveToPage('/6a4c8be9b698d2b7ab35cd6e');

    expect(id).toBe('permalink-hit');
    // permalink branch must not touch the path lookup
    expect(mocks.findByPath).not.toHaveBeenCalled();
  });

  it('returns null when path is not found', async () => {
    mocks.findByPath.mockResolvedValue(null);

    const id = await resolveToPage('/docs/v2');

    expect(id).toBe(null);
  });

  it('returns null when no page exist for the permalink id', async () => {
    mocks.findById.mockResolvedValue(null);

    const id = await resolveToPage('/6a4c8be9b698d2b7ab35cd6e');

    expect(id).toBe(null);
  });
});
