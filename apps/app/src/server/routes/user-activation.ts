import { Response, NextFunction } from 'express';

import type { UserActivationErrorCode } from '~/interfaces/errors/user-activation';
import { ReqWithUserRegistrationOrder } from '~/server/middlewares/inject-user-registration-order-by-token-middleware';

type Crowi = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextApp: any,
}

type CrowiReq = ReqWithUserRegistrationOrder & {
  crowi: Crowi,
}

export const renderUserActivationPage = (crowi: Crowi) => {
  return (req: CrowiReq, res: Response): void => {
    const { userRegistrationOrder } = req;
    const { nextApp } = crowi;
    req.crowi = crowi;
    nextApp.render(req, res, '/user-activation', { userRegistrationOrder });
    return;
  };
};

// middleware to handle error
export const tokenErrorHandlerMiddeware = (crowi: Crowi) => {
  return (error: Error & { code: UserActivationErrorCode, statusCode: number }, req: CrowiReq, res: Response, next: NextFunction): void => {
    if (error != null) {
      const { nextApp } = crowi;
      req.crowi = crowi;
      nextApp.render(req, res, '/user-activation', { errorCode: error.code });
      return;
    }

    next();
  };
};
