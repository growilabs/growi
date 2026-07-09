import { mock } from 'vitest-mock-extended';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import { getUserLocaleForApp } from './locale';

describe('getUserLocaleForApp', () => {
  it('returns undefined without throwing when req is undefined', () => {
    // Next.js re-invokes _app's getInitialProps on the client (with a ctx
    // that omits req/res) when it falls back to rendering the built-in
    // error page after an uncaught client-side render exception.
    expect(getUserLocaleForApp(undefined)).toBeUndefined();
  });

  it('resolves the locale from req when req is present', () => {
    const req = mock<CrowiRequest>();
    req.user = undefined;
    req.headers = {};

    expect(getUserLocaleForApp(req)).toBe('en-US');
  });
});
