import ObjectId from 'bson-objectid';

import { isValidObjectId } from './objectid-utils';

describe('isValidObjectId', () => {
  /* eslint-disable indent */
  describe.concurrent.each`
    arg                                           | expected
    ${undefined}                                  | ${false}
    ${null}                                       | ${false}
    ${'geeks'}                                    | ${false}
    ${'toptoptoptop'}                             | ${false}
    ${'geeksfogeeks'}                             | ${false}
    ${'594ced02ed345b2b049222c5'}                 | ${true}
    ${new ObjectId('594ced02ed345b2b049222c5')}   | ${true}
  `('should return $expected', ({ arg, expected }) => {
    test(`when the argument is '${arg}'`, async () => {
      // when:
      const result = isValidObjectId(arg);

      // then:
      expect(result).toBe(expected);
    });
  });
});
