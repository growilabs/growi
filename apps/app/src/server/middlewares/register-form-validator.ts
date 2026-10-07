import { ErrorV3 } from '@growi/core/dist/models';
import {
  body,
  type ValidationChain,
  validationResult,
} from 'express-validator';

// form rules
export const registerRules = (minPasswordLength: number): ValidationChain[] => {
  return [
    body('registerForm.username')
      .matches(/^[\da-zA-Z\-_.]+$/)
      .withMessage('message.Username has invalid characters')
      .not()
      .isEmpty()
      .withMessage('message.Username field is required'),
    body('registerForm.name')
      .not()
      .isEmpty()
      .withMessage('message.Name field is required'),
    body('registerForm.email')
      .isEmail()
      .withMessage('message.Email format is invalid')
      .exists()
      .withMessage('message.Email field is required'),
    body('registerForm.password')
      .matches(/^[\x20-\x7F]*$/)
      .withMessage('message.Password has invalid character')
      .isLength({ min: minPasswordLength })
      .withMessage(
        new ErrorV3(
          'message.Password minimum character should be more than n characters',
          undefined,
          undefined,
          { number: minPasswordLength },
        ),
      )
      .not()
      .isEmpty()
      .withMessage('message.Password field is required'),
    body('registerForm[app:globalLang]'),
  ];
};

// validation action
export const registerValidation = (req, res, next): ValidationChain[] => {
  const form = req.body;

  const errors = validationResult(req);
  if (errors.isEmpty()) {
    Object.assign(form, { isValid: true });
    req.form = form;
    return next();
  }

  const extractedErrors: string[] = [];
  errors.array().map((err) => extractedErrors.push(err.msg));

  Object.assign(form, {
    isValid: false,
    errors: extractedErrors,
  });
  req.form = form;

  return next();
};
