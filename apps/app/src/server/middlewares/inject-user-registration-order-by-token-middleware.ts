import type { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';

import { UserActivationErrorCode } from '~/interfaces/errors/user-activation';
import loggerFactory from '~/utils/logger';

import type { IUserRegistrationOrder } from '../models/user-registration-order';
import UserRegistrationOrder from '../models/user-registration-order';

const logger = loggerFactory('growi:routes:user-activation');

export type ReqWithUserRegistrationOrder = Request & {
  userRegistrationOrder: IUserRegistrationOrder;
};

// eslint-disable-next-line import/no-anonymous-default-export
export default async (
  req: ReqWithUserRegistrationOrder,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.params.token || req.body.token;

  if (token == null) {
    const msg = 'Token not found';
    logger.error(msg);
    return next(
      createError(400, msg, { code: UserActivationErrorCode.TOKEN_NOT_FOUND }),
    );
  }

  if (typeof token !== 'string') {
    const msg = 'Invalid token format';
    logger.error(msg);
    return next(
      createError(400, msg, { code: UserActivationErrorCode.INVALID_TOKEN }),
    );
  }

  // exec query safely with $eq
  const userRegistrationOrder = await UserRegistrationOrder.findOne({
    token: { $eq: token },
  });

  // check if the token is valid
  if (
    userRegistrationOrder == null ||
    userRegistrationOrder.isExpired() ||
    userRegistrationOrder.isRevoked
  ) {
    const msg = 'userRegistrationOrder is null or expired or revoked';
    logger.error(msg);
    return next(
      createError(400, msg, {
        code: UserActivationErrorCode.USER_REGISTRATION_ORDER_IS_NOT_APPROPRIATE,
      }),
    );
  }

  req.userRegistrationOrder = userRegistrationOrder;

  return next();
};
