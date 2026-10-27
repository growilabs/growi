import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';

// toInt() matters: page grant checks compare with `===`, so a string "5" would skip every GRANT_USER_GROUP check.
export const grantBodyValidator = ({
  required,
}: {
  required: boolean;
}): ValidationChain => {
  const chain = body('grant');
  return (required ? chain : chain.optional())
    .isInt({ min: 0, max: 5 })
    .withMessage('grant must be integer from 1 to 5')
    .toInt();
};
