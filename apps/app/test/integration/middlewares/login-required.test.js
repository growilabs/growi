/* eslint-disable arrow-body-style */

const { getInstance } = require('../setup-crowi');

describe('loginRequired', () => {
  let crowi;
  const fallbackMock = jest.fn().mockReturnValue('fallback');

  let loginRequiredStrictly;
  let loginRequired;
  let loginRequiredWithFallback;

  beforeEach(async () => {
    crowi = await getInstance();
    loginRequiredStrictly = require('~/server/middlewares/login-required')(
      crowi,
    );
    loginRequired = require('~/server/middlewares/login-required')(crowi, true);
    loginRequiredWithFallback = require('~/server/middlewares/login-required')(
      crowi,
      false,
      fallbackMock,
    );
  });

  describe('not strict mode', () => {
    const res = {
      redirect: jest.fn().mockReturnValue('redirect'),
      sendStatus: jest.fn().mockReturnValue('sendStatus'),
    };
    const next = jest.fn().mockReturnValue('next');

    describe('and when aclService.isGuestAllowedToRead() returns false', () => {
      let req;

      let isGuestAllowedToReadSpy;

      beforeEach(async () => {
        // setup req
        req = {
          originalUrl: 'original url 1',
          session: {},
        };
        // reset session object
        req.session = {};
        // prepare spy for AclService.isGuestAllowedToRead
        isGuestAllowedToReadSpy = jest
          .spyOn(crowi.aclService, 'isGuestAllowedToRead')
          .mockImplementation(() => false);
      });

      /* eslint-disable indent */
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

          expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
          expect(next).not.toHaveBeenCalled();
          expect(fallbackMock).not.toHaveBeenCalled();
          expect(res.sendStatus).not.toHaveBeenCalled();
          expect(res.redirect).toHaveBeenCalledTimes(1);
          expect(res.redirect).toHaveBeenCalledWith(expectedPath);
          expect(result).toBe('redirect');
          expect(req.session.redirectTo).toBe(undefined);
        },
      );
      /* eslint-disable indent */

      test("redirect to '/login' when the user does not loggedin", () => {
        req.baseUrl = '/path/that/requires/loggedin';

        const result = loginRequired(req, res, next);

        expect(isGuestAllowedToReadSpy).toHaveBeenCalled();
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

        expect(isGuestAllowedToReadSpy).toHaveBeenCalled();
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(result).toBe('next');
      });
    });

    describe('and when aclService.isGuestAllowedToRead() returns true', () => {
      let req;

      let isGuestAllowedToReadSpy;

      beforeEach(async () => {
        // setup req
        req = {
          originalUrl: 'original url 1',
          session: {},
        };
        // reset session object
        req.session = {};
        // prepare spy for AclService.isGuestAllowedToRead
        isGuestAllowedToReadSpy = jest
          .spyOn(crowi.aclService, 'isGuestAllowedToRead')
          .mockImplementation(() => true);
      });

      /* eslint-disable indent */
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

          expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
          expect(next).not.toHaveBeenCalled();
          expect(fallbackMock).not.toHaveBeenCalled();
          expect(res.sendStatus).not.toHaveBeenCalled();
          expect(res.redirect).toHaveBeenCalledTimes(1);
          expect(res.redirect).toHaveBeenCalledWith(expectedPath);
          expect(result).toBe('redirect');
          expect(req.session.redirectTo).toBe(undefined);
        },
      );
      /* eslint-disable indent */

      test('pass guest user', () => {
        const result = loginRequired(req, res, next);

        expect(isGuestAllowedToReadSpy).toHaveBeenCalledTimes(1);
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(result).toBe('next');
      });

      test('pass anyone into sharedPage', () => {
        req.isSharedPage = true;

        const result = loginRequired(req, res, next);

        expect(isGuestAllowedToReadSpy).toHaveBeenCalled();
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(result).toBe('next');
      });
    });
  });

  describe('strict mode', () => {
    // setup req/res/next
    const req = {
      originalUrl: 'original url 1',
      session: null,
    };
    const res = {
      redirect: jest.fn().mockReturnValue('redirect'),
      sendStatus: jest.fn().mockReturnValue('sendStatus'),
    };
    const next = jest.fn().mockReturnValue('next');

    let isGuestAllowedToReadSpy;

    beforeEach(async () => {
      // reset session object
      req.session = {};
      // spy for AclService.isGuestAllowedToRead
      isGuestAllowedToReadSpy = jest.spyOn(
        crowi.aclService,
        'isGuestAllowedToRead',
      );
    });

    test("send status 403 when 'req.baseUrl' starts with '_api'", () => {
      req.baseUrl = '/_api/someapi';

      const result = loginRequiredStrictly(req, res, next);

      expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
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

      expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(fallbackMock).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledTimes(1);
      expect(res.redirect).toHaveBeenCalledWith('/login');
      expect(result).toBe('redirect');
      expect(req.session.redirectTo).toBe('original url 1');
    });

    test('pass user who logged in', () => {
      const User = crowi.model('User');

      req.user = {
        _id: 'user id',
        status: User.STATUS_ACTIVE,
      };

      const result = loginRequiredStrictly(req, res, next);

      expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
      expect(fallbackMock).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(result).toBe('next');
      expect(req.session.redirectTo).toBe(undefined);
    });

    /* eslint-disable indent */
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

        expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(fallbackMock).not.toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledTimes(1);
        expect(res.redirect).toHaveBeenCalledWith(expectedPath);
        expect(result).toBe('redirect');
        expect(req.session.redirectTo).toBe(undefined);
      },
    );
    /* eslint-disable indent */

    test("redirect to '/login' when user.status is 'STATUS_DELETED'", () => {
      const User = crowi.model('User');

      req.baseUrl = '/path/that/requires/loggedin';
      req.user = {
        _id: 'user id',
        status: User.STATUS_DELETED,
      };

      const result = loginRequiredStrictly(req, res, next);

      expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
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
    // setup req/res/next
    const req = {
      originalUrl: 'original url 1',
      session: null,
    };
    const res = {
      redirect: jest.fn().mockReturnValue('redirect'),
      sendStatus: jest.fn().mockReturnValue('sendStatus'),
    };
    const next = jest.fn().mockReturnValue('next');

    let isGuestAllowedToReadSpy;

    beforeEach(async () => {
      // reset session object
      req.session = {};
      // spy for AclService.isGuestAllowedToRead
      isGuestAllowedToReadSpy = jest.spyOn(
        crowi.aclService,
        'isGuestAllowedToRead',
      );
    });

    test("invoke fallback when 'req.path' starts with '_api'", () => {
      req.path = '/_api/someapi';

      const result = loginRequiredWithFallback(req, res, next);

      expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
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

      expect(isGuestAllowedToReadSpy).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(fallbackMock).toHaveBeenCalledTimes(1);
      expect(fallbackMock).toHaveBeenCalledWith(req, res, next);
      expect(result).toBe('fallback');
    });
  });
});
