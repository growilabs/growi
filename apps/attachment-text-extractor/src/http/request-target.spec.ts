import { endpointOf, isOpenEndpoint } from './request-target';

// Same verdicts as open-path-targets.integ.ts, without a server: only the
// target exactly as sent names an endpoint.

describe('endpointOf', () => {
  it.each([
    '/extract',
    '/healthz',
    '/readyz',
    '/openapi.json',
  ])('the exact path %s is its own label', (path) => {
    expect(endpointOf(path)).toBe(path);
  });

  it.each([
    '/./healthz',
    '/a/../healthz',
    '/%2e/healthz',
    '/%68ealthz',
    '//healthz',
    '/readyz/.',
    '/%6Fpenapi.json',
    'http://test/healthz',
    '/healthz/../extract',
    '/./extract',
    '//extract',
    'http://test/extract',
    '/healthz/',
    '/unknown',
    '',
  ])('%j is other, even where routing would resolve it to a path', (target) => {
    expect(endpointOf(target)).toBe('other');
  });

  it.each([
    ['/healthz?x=1', '/healthz'],
    ['/openapi.json?any=query', '/openapi.json'],
    ['/extract?', '/extract'],
    ['/./healthz?x=1', 'other'],
    ['/unknown?/healthz', 'other'],
  ])('%s is labeled by the part before "?": %s', (target, label) => {
    expect(endpointOf(target)).toBe(label);
  });
});

describe('isOpenEndpoint', () => {
  it.each([
    ['/healthz', true],
    ['/readyz', true],
    ['/openapi.json', true],
    ['/openapi.json?any=query', true],
    ['/extract', false],
    ['/extract?x=1', false],
    ['/./healthz', false],
    ['//healthz', false],
    ['http://test/healthz', false],
    ['/unknown', false],
  ])('%s needs no token: %s', (target, open) => {
    expect(isOpenEndpoint(target)).toBe(open);
  });
});
