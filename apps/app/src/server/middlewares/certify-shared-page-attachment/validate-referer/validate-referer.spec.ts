import { objectIdUtils } from '@growi/core/dist/utils';

import { validateReferer } from './validate-referer';

const mocks = vi.hoisted(() => {
  return {
    retrieveSiteUrlMock: vi.fn(),
  };
});

vi.mock('./retrieve-site-url', () => ({
  retrieveSiteUrl: mocks.retrieveSiteUrlMock,
}));

describe('validateReferer', () => {
  const isValidObjectIdSpy = vi.spyOn(objectIdUtils, 'isValidObjectId');

  beforeEach(() => {
    isValidObjectIdSpy.mockClear();
  });

  describe('refurns false', () => {
    it('when the referer argument is undefined', () => {
      // setup

      // when
      const result = validateReferer(undefined);

      // then
      expect(result).toBeFalsy();
      expect(mocks.retrieveSiteUrlMock).not.toHaveBeenCalled();
      expect(isValidObjectIdSpy).not.toHaveBeenCalled();
    });

    it('when the referer is invalid', () => {
      // when
      const result = validateReferer('invalid URL');

      // then
      expect(result).toBeFalsy();
      expect(mocks.retrieveSiteUrlMock).not.toHaveBeenCalledOnce();
      expect(isValidObjectIdSpy).not.toHaveBeenCalled();
    });

    it('when the siteUrl returns null', () => {
      // setup
      mocks.retrieveSiteUrlMock.mockImplementation(() => {
        return null;
      });

      // when
      const refererString = 'https://example.org/share/xxxxx';
      const result = validateReferer(refererString);

      // then
      expect(result).toBeFalsy();
      expect(mocks.retrieveSiteUrlMock).toHaveBeenCalledOnce();
      expect(isValidObjectIdSpy).not.toHaveBeenCalled();
    });

    it('when the hostname of the referer does not match with siteUrl', () => {
      // setup
      mocks.retrieveSiteUrlMock.mockImplementation(() => {
        return new URL('https://example.com');
      });

      // when
      const refererString = 'https://example.org/share/xxxxx';
      const result = validateReferer(refererString);

      // then
      expect(result).toBeFalsy();
      expect(mocks.retrieveSiteUrlMock).toHaveBeenCalledOnce();
      expect(isValidObjectIdSpy).not.toHaveBeenCalled();
    });

    it('when the port of the referer does not match with siteUrl', () => {
      // setup
      mocks.retrieveSiteUrlMock.mockImplementation(() => {
        return new URL('https://example.com');
      });

      // when
      const refererString = 'https://example.com:8080/share/xxxxx';
      const result = validateReferer(refererString);

      // then
      expect(result).toBeFalsy();
      expect(mocks.retrieveSiteUrlMock).toHaveBeenCalledOnce();
      expect(isValidObjectIdSpy).not.toHaveBeenCalled();
    });

    it('when the shareLinkId is invalid', () => {
      // setup
      mocks.retrieveSiteUrlMock.mockImplementation(() => {
        return new URL('https://example.com');
      });

      // when
      const refererString =
        'https://example.com/share/FFFFFFFFFFFFFFFFFFFFFFFF';
      const result = validateReferer(refererString);

      // then
      expect(result).toBeFalsy();
      expect(mocks.retrieveSiteUrlMock).toHaveBeenCalledOnce();
      expect(isValidObjectIdSpy).toHaveBeenCalledOnce();
    });
  });

  it('returns ValidReferer instance', () => {
    // setup
    mocks.retrieveSiteUrlMock.mockImplementation(() => {
      return new URL('https://example.com');
    });

    // when
    const shareLinkId = '65436ba09ae6983bd608b89c';
    const refererString = `https://example.com/share/${shareLinkId}`;
    const result = validateReferer(refererString);

    // then
    expect(result).toStrictEqual({
      referer: refererString,
      shareLinkId,
    });
  });
});
