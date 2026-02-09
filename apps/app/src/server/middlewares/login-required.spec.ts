import type Crowi from '../crowi';
import { UserStatus } from '../models/user/conts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoginRequiredMiddleware = (req: any, res: any, next: any) => any;

describe('loginRequired', () => {
  let fallbackMock: ReturnType<typeof vi.fn>;

  let loginRequiredStrictly: LoginRequiredMiddleware;
  let loginRequired: LoginRequiredMiddleware;
  let loginRequiredWithFallback: LoginRequiredMiddleware;

  // Mock Crowi with only the required aclService
  const aclServiceMock = {
    isGuestAllowedToRead: vi.fn(),
  };
  const crowiMock = {
    aclService: aclServiceMock,
  } as unknown as Crowi;

  beforeEach(async () => {
    vi.resetAllMocks();
    fallbackMock = vi.fn().mockReturnValue('fallback');

    // Use dynamic import to load the middleware factory
    const loginRequiredFactory = (await import('./login-required')).default;

    loginRequiredStrictly = loginRequiredFactory(crowiMock);
    loginRequired = loginRequiredFactory(crowiMock, true);
    loginRequiredWithFallback = loginRequiredFactory(
      crowiMock,
      false,
      fallbackMock,
    );
  });

  describe('not strict mode', () => {
    describe('and when aclService.isGuestAllowedToRead() returns false', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let req: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let res: any;
      let next: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        // setup req
        req = {
          originalUrl: 'original url 1',
          session: {},
        };
        res = {
          redirect: vi.fn().mockReturnValue('redirect'),
          sendStatus: vi.fn().mockReturnValue('sendStatus'),
        };
        next = vi.fn().mockReturnValue('next');
        // prepare mock for AclService.isGuestAllowedToRead
        aclServiceMock.isGuestAllowedToRead.mockReturnValue(false);
      });

      test.each`
        userStatus | expectedPath
        ${1}       | ${'/login/error/registered'}
        ${3}       | ${'/login/error/suspended'}
        ${5}       | ${'/invited'}
      `(
        "redirect to '$expectedPath' when user.status is '$userStatus'",
        ({ userStatus, expectedPath }) => {
          req.user = {
            _id: 'user id',
            status: userStatus,
          };

          const result = loginRequired(req, res, next);

          expect(
            crowiMock.aclService.isGuestAllowedToRead,
          ).not.toHaveBeenCalled();
          expect(next).not.toHaveBeenCalled();
          expect(fallbackMock).not.toHaveBeenCalled();
          expect(res.sendStatus).not.toHaveBeenCalled();
          expect(res.redirect).toHaveBeenCalledTimes(1);
          expect(res.redirect).toHaveBeenCalledWith(expectedPath);
          expect(result).toBe('redirect');
          expect(req.session.redirectTo).toBe(undefined);
        },
      );

      test("redirect to '/login' when the user does not loggedin", () => {
        req.baseUrl = '/path/that/requires/loggedin';

        const result = loginRequired(req, res, next);

        expect(crowiMock.aclService.isGuestAllowedToRead).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledTimes(1);
        expect(res.redirect).toHaveBeenCalledWith('/login');
        expect(result).toBe('redirect');
        expect(req.session.redirectTo).toBe('original url 1');
      });

      test('pass anyone into sharedPage', () => {
        req.isSharedPage = true;

        const result = loginRequired(req, res, next);

        expect(crowiMock.aclService.isGuestAllowedToRead).toHaveBeenCalled();
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(result).toBe('next');
      });
    });

    describe('and when aclService.isGuestAllowedToRead() returns true', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let req: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let res: any;
      let next: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        // setup req
        req = {
          originalUrl: 'original url 1',
          session: {},
        };
        res = {
          redirect: vi.fn().mockReturnValue('redirect'),
          sendStatus: vi.fn().mockReturnValue('sendStatus'),
        };
        next = vi.fn().mockReturnValue('next');
        // prepare mock for AclService.isGuestAllowedToRead
        aclServiceMock.isGuestAllowedToRead.mockReturnValue(true);
      });

      test.each`
        userStatus | expectedPath
        ${1}       | ${'/login/error/registered'}
        ${3}       | ${'/login/error/suspended'}
        ${5}       | ${'/invited'}
      `(
        "redirect to '$expectedPath' when user.status is '$userStatus'",
        ({ userStatus, expectedPath }) => {
          req.user = {
            _id: 'user id',
            status: userStatus,
          };

          const result = loginRequired(req, res, next);

          expect(
            crowiMock.aclService.isGuestAllowedToRead,
          ).not.toHaveBeenCalled();
          expect(next).not.toHaveBeenCalled();
          expect(fallbackMock).not.toHaveBeenCalled();
          expect(res.sendStatus).not.toHaveBeenCalled();
          expect(res.redirect).toHaveBeenCalledTimes(1);
          expect(res.redirect).toHaveBeenCalledWith(expectedPath);
          expect(result).toBe('redirect');
          expect(req.session.redirectTo).toBe(undefined);
        },
      );

      test('pass guest user', () => {
        const result = loginRequired(req, res, next);

        expect(crowiMock.aclService.isGuestAllowedToRead).toHaveBeenCalledTimes(
          1,
        );
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(result).toBe('next');
      });

      test('pass anyone into sharedPage', () => {
        req.isSharedPage = true;

        const result = loginRequired(req, res, next);

        expect(crowiMock.aclService.isGuestAllowedToRead).toHaveBeenCalled();
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(result).toBe('next');
      });
    });
  });

  describe('strict mode', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let req: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: any;
    let next: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      req = {
        originalUrl: 'original url 1',
        session: {},
      };
      res = {
        redirect: vi.fn().mockReturnValue('redirect'),
        sendStatus: vi.fn().mockReturnValue('sendStatus'),
      };
      next = vi.fn().mockReturnValue('next');
    });

    test("send status 403 when 'req.baseUrl' starts with '_api'", () => {
      req.baseUrl = '/_api/someapi';

      const result = loginRequiredStrictly(req, res, next);

      expect(crowiMock.aclService.isGuestAllowedToRead).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(fallbackMock).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.sendStatus).toHaveBeenCalledTimes(1);
      expect(res.sendStatus).toHaveBeenCalledWith(403);
      expect(result).toBe('sendStatus');
    });

    test("redirect to '/login' when the user does not loggedin", () => {
      req.baseUrl = '/path/that/requires/loggedin';

      const result = loginRequiredStrictly(req, res, next);

      expect(crowiMock.aclService.isGuestAllowedToRead).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(fallbackMock).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith('/login');
      expect(result).toBe('redirect');
      expect(req.session.redirectTo).toBe('original url 1');
    });

    test('pass user who logged in', () => {
      req.user = {
        _id: 'user id',
        status: UserStatus.STATUS_ACTIVE,
      };

      const result = loginRequiredStrictly(req, res, next);

      expect(crowiMock.aclService.isGuestAllowedToRead).not.toHaveBeenCalled();
      expect(fallbackMock).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(result).toBe('next');
      expect(req.session.redirectTo).toBe(undefined);
    });

    test.each`
      userStatus | expectedPath
      ${1}       | ${'/login/error/registered'}
      ${3}       | ${'/login/error/suspended'}
      ${5}       | ${'/invited'}
    `(
      "redirect to '$expectedPath' when user.status is '$userStatus'",
      ({ userStatus, expectedPath }) => {
        req.user = {
          _id: 'user id',
          status: userStatus,
        };

        const result = loginRequiredStrictly(req, res, next);

        expect(
          crowiMock.aclService.isGuestAllowedToRead,
        ).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledTimes(1);
        expect(res.redirect).toHaveBeenCalledWith(expectedPath);
        expect(result).toBe('redirect');
        expect(req.session.redirectTo).toBe(undefined);
      },
    );

    test("redirect to '/login' when user.status is 'STATUS_DELETED'", () => {
      req.baseUrl = '/path/that/requires/loggedin';
      req.user = {
        _id: 'user id',
        status: UserStatus.STATUS_DELETED,
      };

      const result = loginRequiredStrictly(req, res, next);

      expect(crowiMock.aclService.isGuestAllowedToRead).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(fallbackMock).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith('/login');
      expect(result).toBe('redirect');
      expect(req.session.redirectTo).toBe(undefined);
    });
  });

  describe('specified fallback', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let req: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: any;
    let next: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      req = {
        originalUrl: 'original url 1',
        session: {},
      };
      res = {
        redirect: vi.fn().mockReturnValue('redirect'),
        sendStatus: vi.fn().mockReturnValue('sendStatus'),
      };
      next = vi.fn().mockReturnValue('next');
    });

    test("invoke fallback when 'req.path' starts with '_api'", () => {
      req.path = '/_api/someapi';

      const result = loginRequiredWithFallback(req, res, next);

      expect(crowiMock.aclService.isGuestAllowedToRead).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(fallbackMock).toHaveBeenCalledTimes(1);
      expect(fallbackMock).toHaveBeenCalledWith(req, res, next);
      expect(result).toBe('fallback');
    });

    test('invoke fallback when the user does not loggedin', () => {
      req.path = '/path/that/requires/loggedin';

      const result = loginRequiredWithFallback(req, res, next);

      expect(crowiMock.aclService.isGuestAllowedToRead).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(fallbackMock).toHaveBeenCalledTimes(1);
      expect(fallbackMock).toHaveBeenCalledWith(req, res, next);
      expect(result).toBe('fallback');
    });
  });
});
