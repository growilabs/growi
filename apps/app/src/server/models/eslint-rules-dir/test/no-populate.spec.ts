import { RuleTester } from 'eslint';

import noPopulate from '../no-populate';

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2015,
  },
});

test('test no-populate', () => {
  ruleTester.run('no-populate', noPopulate, {
    valid: [{ code: 'Model.find();' }],
    invalid: [
      {
        code: "Model.find().populate('children');",
        errors: [
          {
            message:
              "The 'populate' method should not be called in model modules.",
          },
        ],
      },
    ],
  });
});
