import { validationResult } from 'express-validator';

import { grantBodyValidator } from './grant-body-validator';

const runValidator = async (
  required: boolean,
  reqBody: Record<string, unknown>,
) => {
  const req = { body: reqBody };
  await grantBodyValidator({ required }).run(req);
  return { isValid: validationResult(req).isEmpty(), body: req.body };
};

describe('grantBodyValidator', () => {
  it.each([
    true,
    false,
  ])('converts a numeric string to a number so strict grant comparisons downstream work (required=%s)', async (required) => {
    const { isValid, body } = await runValidator(required, { grant: '5' });

    expect(isValid).toBe(true);
    expect(body.grant).toBe(5);
  });

  it.each([
    true,
    false,
  ])('rejects a value outside the grant range (required=%s)', async (required) => {
    const { isValid } = await runValidator(required, { grant: 6 });

    expect(isValid).toBe(false);
  });

  it('accepts an absent grant only when it is optional', async () => {
    expect((await runValidator(false, {})).isValid).toBe(true);
    expect((await runValidator(true, {})).isValid).toBe(false);
  });
});
