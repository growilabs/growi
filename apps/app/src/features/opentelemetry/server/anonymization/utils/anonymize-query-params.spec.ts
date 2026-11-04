import { describe, expect, it } from 'vitest';

import { anonymizeQueryParams } from './anonymize-query-params';

describe('anonymizeQueryParams', () => {
  it.each`
    description                      | search                                   | paramNames          | expected
    ${'a targeted name'}             | ${'q=secret&other=keep'}                 | ${['q']}            | ${'q=%5BANONYMIZED%5D&other=keep'}
    ${'name[]'}                      | ${'paths[]=a&paths[]=b'}                 | ${['paths']}        | ${'paths[]=%5BANONYMIZED%5D&paths[]=%5BANONYMIZED%5D'}
    ${'encoded name[]'}              | ${'paths%5B%5D=a&x=1'}                   | ${['paths']}        | ${'paths%5B%5D=%5BANONYMIZED%5D&x=1'}
    ${'encoded indexed names'}       | ${'paths%5B0%5D=%2Fa&paths%5B1%5D=%2Fb'} | ${['paths']}        | ${'paths%5B0%5D=%5BANONYMIZED%5D&paths%5B1%5D=%5BANONYMIZED%5D'}
    ${'an indexed name'}             | ${'paths[0]=a&x=1'}                      | ${['paths']}        | ${'paths[0]=%5BANONYMIZED%5D&x=1'}
    ${'a nested bracketed name'}     | ${'a[b][0]=x&c=1'}                       | ${['a']}            | ${'a[b][0]=%5BANONYMIZED%5D&c=1'}
    ${'a bracket-only name'}         | ${'[q]=1&q2[0]=2'}                       | ${['q']}            | ${'[q]=1&q2[0]=2'}
    ${'percent-encoded name'}        | ${'%70ath=a'}                            | ${['path']}         | ${'%70ath=%5BANONYMIZED%5D'}
    ${'a JSON array'}                | ${'paths=["/user/john","/a"]'}           | ${['paths']}        | ${'paths=%5B%22%5BANONYMIZED%5D%22%5D'}
    ${'an encoded JSON array'}       | ${'paths=%5B%22%2Fa%22%5D'}              | ${['paths']}        | ${'paths=%5B%22%5BANONYMIZED%5D%22%5D'}
    ${'an empty JSON array'}         | ${'paths=[]'}                            | ${['paths']}        | ${'paths=%5BANONYMIZED%5D'}
    ${'repeated names'}              | ${'path=a&x=1&path=b'}                   | ${['path']}         | ${'path=%5BANONYMIZED%5D&x=1&path=%5BANONYMIZED%5D'}
    ${'a pair without ='}            | ${'q&other=value'}                       | ${['q']}            | ${'q=%5BANONYMIZED%5D&other=value'}
    ${'an empty value'}              | ${'q=&other=value'}                      | ${['q']}            | ${'q=%5BANONYMIZED%5D&other=value'}
    ${'non-target pairs untouched'}  | ${'a=%2Fx%20y+z&q=1&b=%ZZ'}              | ${['q']}            | ${'a=%2Fx%20y+z&q=%5BANONYMIZED%5D&b=%ZZ'}
    ${'multiple names'}              | ${'q=1&path=2&o=3'}                      | ${['q', 'path']}    | ${'q=%5BANONYMIZED%5D&path=%5BANONYMIZED%5D&o=3'}
    ${'no target present'}           | ${'other=value&another=test'}            | ${['q']}            | ${'other=value&another=test'}
    ${'a name that only prefixes'}   | ${'qq=1&q2=2'}                           | ${['q']}            | ${'qq=1&q2=2'}
    ${'an empty query'}              | ${''}                                    | ${['q']}            | ${''}
    ${'empty paramNames'}            | ${'q=secret'}                            | ${[]}               | ${'q=secret'}
    ${'an empty name'}               | ${'=x&q=1'}                              | ${['q']}            | ${'=x&q=%5BANONYMIZED%5D'}
    ${'empty pairs'}                 | ${'a=1&&q=2&'}                           | ${['q']}            | ${'a=1&&q=%5BANONYMIZED%5D&'}
    ${'a bare name before a pair'}   | ${'q&q=1'}                               | ${['q']}            | ${'q=%5BANONYMIZED%5D&q=%5BANONYMIZED%5D'}
    ${'+ in a name as a space'}      | ${'q+p=1&q+=2'}                          | ${['q p']}          | ${'q+p=%5BANONYMIZED%5D&q+=2'}
    ${'a leading + in a name'}       | ${'+q=1&q=2'}                            | ${[' q']}           | ${'+q=%5BANONYMIZED%5D&q=2'}
    ${'a trailing + in a name'}      | ${'q+=1'}                                | ${['q']}            | ${'q+=1'}
    ${'a malformed escaped name'}    | ${'q%E6=1&q%zz[0]=2'}                    | ${['q%E6', 'q%zz']} | ${'q%E6=%5BANONYMIZED%5D&q%zz[0]=%5BANONYMIZED%5D'}
    ${'a value holding = and ['}     | ${'q=a=b[c]&x=[q]'}                      | ${['q']}            | ${'q=%5BANONYMIZED%5D&x=[q]'}
    ${'a name sharing a first char'} | ${'pa=1&pat=2&path0=3&path=4'}           | ${['path']}         | ${'pa=1&pat=2&path0=3&path=%5BANONYMIZED%5D'}
    ${'an empty target name'}        | ${'=x&[a]=y&b=z'}                        | ${['']}             | ${'=%5BANONYMIZED%5D&[a]=%5BANONYMIZED%5D&b=z'}
  `('should handle $description', ({ search, paramNames, expected }) => {
    expect(anonymizeQueryParams(search, paramNames)).toBe(expected);
  });
});
