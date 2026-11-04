import { body } from 'express-validator';

export const expiredAtValidator = () =>
  body('expiredAt')
    .if((value) => value != null)
    .custom((value) => new Date(value).getTime() > Date.now())
    .withMessage('Your Selected date is past');
