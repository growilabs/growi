import type { NextFunction, Response } from 'express';
import type { ValidationChain } from 'express-validator';
import { body, validationResult } from 'express-validator';
import type { Request } from 'express-validator/src/base';

const MININUM_PASSWORD_LENGTH = 6;

export const invitedRules = (): ValidationChain[] => {
  return [
    body('invitedForm.username')
      .matches(/^[\da-zA-Z\-_.]+$/)
      .withMessage('message.Username has invalid characters')
      .not()
      .isEmpty()
      .withMessage('message.Username field is required'),
    body('invitedForm.name')
      .not()
      .isEmpty()
      .withMessage('message.Name field is required'),
    body('invitedForm.password')
      .matches(/^[\x20-\x7F]*$/)
      .withMessage('message.Password has invalid character')
      .isLength({ min: MININUM_PASSWORD_LENGTH })
      .withMessage(
        `message.Password minimum character should be more than ${MININUM_PASSWORD_LENGTH} characters`,
      )
      .not()
      .isEmpty()
      .withMessage('message.Password field is required'),
  ];
};

export const invitedValidation = (
  req: Request,
  _res: Response,
  next: () => NextFunction,
): any => {
  const form = req.body;
  const errors = validationResult(req);
  const extractedErrors: string[] = [];

  if (errors.isEmpty()) {
    Object.assign(form, { isValid: true });
  } else {
    errors.array().map((err) => extractedErrors.push(err.msg));
    Object.assign(form, { isValid: false, errors: extractedErrors });
  }

  req.form = form;
  return next();
};
