// mocking modules
const mocks = vi.hoisted(() => {
  return {
    listPagesMock: vi.fn(),
  };
});

vi.mock('./routes/list-pages/index.js', () => ({
  listPages: mocks.listPagesMock,
}));

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires resolveTagPageIds through to listPages and registers the /_api/lsx route without error', async () => {
    // setup
    const handlerMock = vi.fn();
    mocks.listPagesMock.mockReturnValue(handlerMock);

    const resolveTagPageIdsMock = vi.fn();

    const crowiMock = {
      loginRequiredFactory: vi.fn().mockReturnValue(vi.fn()),
      accessTokenParser: vi.fn().mockReturnValue(vi.fn()),
      pageService: {
        getExcludedPathsBySystem: vi.fn().mockReturnValue([]),
      },
    };

    const appMock = { get: vi.fn() };

    const { default: middleware } = await import('./index.js');

    // when
    expect(() => {
      middleware(crowiMock, appMock, {
        resolveTagPageIds: resolveTagPageIdsMock,
      });
    }).not.toThrow();

    // then
    expect(appMock.get).toHaveBeenCalledWith(
      '/_api/lsx',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      handlerMock,
    );
    expect(mocks.listPagesMock).toHaveBeenCalledWith(
      expect.objectContaining({ resolveTagPageIds: resolveTagPageIdsMock }),
    );
  });
});
