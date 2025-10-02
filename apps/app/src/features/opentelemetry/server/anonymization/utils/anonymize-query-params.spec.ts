import { describe, expect, it } from 'vitest';

import { anonymizeQueryParams } from './anonymize-query-params';

describe('anonymizeQueryParams', () => {
  /* eslint-disable max-len */
  it.each`
    description                     | target                                                            | paramNames         | expected
    ${'no matching parameters'}     | ${'/_api/v3/test?other=value&another=test'}                       | ${['nonexistent']} | ${'/_api/v3/test?other=value&another=test'}
    ${'single string parameter'}    | ${'/_api/v3/search?q=sensitive-query'}                            | ${['q']}           | ${'/_api/v3/search?q=%5BANONYMIZED%5D'}
    ${'array-style parameters'}     | ${'/_api/v3/page/test?paths[]=/user/john&paths[]=/user/jane'}     | ${['paths']}       | ${'/_api/v3/page/test?paths%5B%5D=%5BANONYMIZED%5D'}
    ${'JSON array format'}          | ${'/_api/v3/test?paths=["/user/john","/user/jane"]'}              | ${['paths']}       | ${'/_api/v3/test?paths=%5B%22%5BANONYMIZED%5D%22%5D'}
    ${'multiple parameters'}        | ${'/_api/v3/test?q=secret&path=/user/john&other=keep'}            | ${['q', 'path']}   | ${'/_api/v3/test?q=%5BANONYMIZED%5D&path=%5BANONYMIZED%5D&other=keep'}
    ${'empty parameter value'}      | ${'/_api/v3/test?q=&other=value'}                                 | ${['q']}           | ${'/_api/v3/test?q=%5BANONYMIZED%5D&other=value'}
    ${'parameter without value'}    | ${'/_api/v3/test?q&other=value'}                                  | ${['q']}           | ${'/_api/v3/test?q=%5BANONYMIZED%5D&other=value'}
    ${'mixed array and single'}     | ${'/_api/v3/test?q=search&paths[]=/user/john&paths[]=/user/jane'} | ${['q', 'paths']}  | ${'/_api/v3/test?q=%5BANONYMIZED%5D&paths%5B%5D=%5BANONYMIZED%5D'}
    ${'with section'}               | ${'/_api/v3/test?q=search#section'}                               | ${['q']}           | ${'/_api/v3/test?q=%5BANONYMIZED%5D#section'}
    ${'malformed JSON array'}       | ${'/_api/v3/test?paths=["/user/john"'}                            | ${['paths']}       | ${'/_api/v3/test?paths=%5BANONYMIZED%5D'}
    ${'empty JSON array'}           | ${'/_api/v3/test?paths=[]'}                                       | ${['paths']}       | ${'/_api/v3/test?paths=%5BANONYMIZED%5D'}
    ${'single item JSON array'}     | ${'/_api/v3/test?paths=["/user/john"]'}                           | ${['paths']}       | ${'/_api/v3/test?paths=%5B%22%5BANONYMIZED%5D%22%5D'}
    ${'URL with no query params'}   | ${'/_api/v3/test'}                                                | ${['q']}           | ${'/_api/v3/test'}
    ${'complex path with encoding'} | ${'/_api/v3/test?path=%2Fuser%2Fjohn%20doe'}                      | ${['path']}        | ${'/_api/v3/test?path=%5BANONYMIZED%5D'}
  `('should handle $description', ({ target, paramNames, expected }) => {
    /* eslint-enable max-len */
    const result = anonymizeQueryParams(target, paramNames);
    expect(result).toBe(expected);
  });

  it.each`
    description                 | target                      | paramNames | expected
    ${'invalid URL format'}     | ${'not-a-valid-url'}        | ${['q']}   | ${'not-a-valid-url'}
    ${'empty string target'}    | ${''}                       | ${['q']}   | ${''}
    ${'empty paramNames array'} | ${'/_api/v3/test?q=secret'} | ${[]}      | ${'/_api/v3/test?q=secret'}
  `(
    'should handle edge cases: $description',
    ({ target, paramNames, expected }) => {
      const result = anonymizeQueryParams(target, paramNames);
      expect(result).toBe(expected);
    },
  );
});
