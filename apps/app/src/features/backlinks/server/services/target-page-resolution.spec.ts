import { resolveToPage } from './target-page-resolution';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: {
    model: () => ({
      findById: mocks.findById,
      findOne: mocks.findOne,
    }),
  },
}));

describe('resolveToPage()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves page id from path', async () => {
    mocks.findById.mockResolvedValue({
      _id: 'permalink-hit',
      path: '/6a4c8be9b698d2b7ab35cd6e',
    });
    mocks.findOne.mockResolvedValue({ _id: 'path-hit', path: '/docs/v2' });

    const path = '/docs/v2';
    const id = await resolveToPage(path);

    expect(id).toBe('path-hit');
  });

  it('resolves page id from permalink path', async () => {
    mocks.findById.mockResolvedValue({
      _id: 'permalink-hit',
      path: '/6a4c8be9b698d2b7ab35cd6e',
    });
    mocks.findOne.mockResolvedValue({ _id: 'path-hit', path: '/docs/v2' });

    const path = '/6a4c8be9b698d2b7ab35cd6e';
    const id = await resolveToPage(path);

    expect(id).toBe('permalink-hit');
  });

  it('returns null when path is not found', async () => {
    mocks.findOne.mockResolvedValue(null);

    const path = '/docs/v2';
    const id = await resolveToPage(path);

    expect(id).toBe(null);
  });

  it('returns null when no page exist for the permalink id', async () => {
    mocks.findById.mockResolvedValue(null);

    const path = '/6a4c8be9b698d2b7ab35cd6e';
    const id = await resolveToPage(path);

    expect(id).toBe(null);
  });
});
