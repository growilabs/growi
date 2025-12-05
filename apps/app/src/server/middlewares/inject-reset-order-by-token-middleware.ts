import type { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';

import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import loggerFactory from '~/utils/logger';

import type { IPasswordResetOrder } from '../models/password-reset-order';
import PasswordResetOrder from '../models/password-reset-order';

const logger = loggerFactory('growi:routes:forgot-password');

export type ReqWithPasswordResetOrder = Request & {
  passwordResetOrder: IPasswordResetOrder;
};

// eslint-disable-next-line import/no-anonymous-default-export
export default async (
  req: ReqWithPasswordResetOrder,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token: string = req.params.token || req.body.token;

  if (token == null) {
    logger.error('Token not found');
    return next(
      createError(400, 'Token not found', {
        code: forgotPasswordErrorCode.TOKEN_NOT_FOUND,
      }),
    );
  }

  const passwordResetOrder = await PasswordResetOrder.findOne({
    token: { $eq: token },
  });

  // check if the token is valid
  if (
    passwordResetOrder == null ||
    passwordResetOrder.isExpired() ||
    passwordResetOrder.isRevoked
  ) {
    const message = 'passwordResetOrder is null or expired or revoked';
    logger.error(message);
    return next(
      createError(400, 'passwordResetOrder is null or expired or revoked', {
        code: forgotPasswordErrorCode.PASSWORD_RESET_ORDER_IS_NOT_APPROPRIATE,
      }),
    );
  }

  req.passwordResetOrder = passwordResetOrder;

  return next();
};
