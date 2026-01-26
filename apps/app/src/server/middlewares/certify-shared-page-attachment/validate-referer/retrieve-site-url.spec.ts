import { retrieveSiteUrl } from './retrieve-site-url';

const mocks = vi.hoisted(() => {
  return {
    configManagerMock: {
      getConfig: vi.fn(),
    },
  };
});

vi.mock('~/server/service/config-manager', () => {
  return { configManager: mocks.configManagerMock };
});

describe('retrieveSiteUrl', () => {
  describe('returns null', () => {
    it('when the siteUrl is not set', () => {
      // setup
      mocks.configManagerMock.getConfig.mockImplementation(() => {
        return null;
      });

      // when
      const result = retrieveSiteUrl();

      // then
      expect(result).toBeNull();
    });

    it('when the siteUrl is invalid', () => {
      // setup
      mocks.configManagerMock.getConfig.mockImplementation(() => {
        return 'invalid siteUrl string';
      });

      // when
      const result = retrieveSiteUrl();

      // then
      expect(result).toBeNull();
    });
  });

  it('returns a URL instance', () => {
    // setup
    const siteUrl = 'https://example.com';
    mocks.configManagerMock.getConfig.mockImplementation(() => siteUrl);

    // when
    const result = retrieveSiteUrl();

    // then
    expect(result).toEqual(new URL(siteUrl));
  });
});
