import { query, type ValidationChain } from 'express-validator';

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;

// isString() first rejects qs-built arrays and objects (e.g. `limit[]=1`).
export const limitValidator = (): ValidationChain =>
  query('limit')
    .optional()
    .isString()
    .bail()
    .isInt({ min: 1, max: LIST_MAX_LIMIT })
    .withMessage(`limit must be an integer between 1 and ${LIST_MAX_LIMIT}`);

export const toLimit = (value: string | undefined): number =>
  value == null ? LIST_DEFAULT_LIMIT : Number(value);
