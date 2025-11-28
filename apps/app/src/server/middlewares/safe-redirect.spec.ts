import type { Request } from 'express';

import registerSafeRedirectFactory, {
  type ResWithSafeRedirect,
} from './safe-redirect';

describe('safeRedirect', () => {
  const whitelistOfHosts = ['white1.example.com:8080', 'white2.example.com'];
  const registerSafeRedirect = registerSafeRedirectFactory(whitelistOfHosts);

  describe('res.safeRedirect', () => {
    // setup req/res/next
    const getFunc = vi.fn().mockReturnValue('example.com');
    const req = {
      protocol: 'http',
      hostname: 'example.com',
      get: getFunc,
    } as any as Request;

    const redirect = vi.fn();
    const res = {
      redirect,
    } as any as ResWithSafeRedirect;
    const next = vi.fn();

    test("redirects to '/' because specified url causes open redirect vulnerability", () => {
      registerSafeRedirect(req, res, next);

      res.safeRedirect('//evil.example.com');

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.get).toHaveBeenCalledWith('host');
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test("redirects to '/' because specified host without port is not in whitelist", () => {
      registerSafeRedirect(req, res, next);

      res.safeRedirect('http://white1.example.com/path/to/page');

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.get).toHaveBeenCalledWith('host');
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test('redirects to the specified local url', () => {
      registerSafeRedirect(req, res, next);

      res.safeRedirect('/path/to/page');

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.get).toHaveBeenCalledWith('host');
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith(
        'http://example.com/path/to/page',
      );
    });

    test('redirects to the specified local url (fqdn)', () => {
      registerSafeRedirect(req, res, next);

      res.safeRedirect('http://example.com/path/to/page');

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.get).toHaveBeenCalledWith('host');
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith(
        'http://example.com/path/to/page',
      );
    });

    test('redirects to the specified whitelisted url (white1.example.com:8080)', () => {
      registerSafeRedirect(req, res, next);

      res.safeRedirect('http://white1.example.com:8080/path/to/page');

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.get).toHaveBeenCalledWith('host');
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith(
        'http://white1.example.com:8080/path/to/page',
      );
    });

    test('redirects to the specified whitelisted url (white2.example.com:8080)', () => {
      registerSafeRedirect(req, res, next);

      res.safeRedirect('http://white2.example.com:8080/path/to/page');

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.get).toHaveBeenCalledWith('host');
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith(
        'http://white2.example.com:8080/path/to/page',
      );
    });
  });
});
