import { sanitizeEndpointForIndex } from './sanitize-endpoint-for-index';

describe('sanitizeEndpointForIndex()', () => {
  it('keeps an endpoint that has no query string', () => {
    expect(sanitizeEndpointForIndex('/_api/v3/pages/revert')).toBe(
      '/_api/v3/pages/revert',
    );
  });

  it('drops the query string so a credential passed as access_token is not indexed', () => {
    expect(
      sanitizeEndpointForIndex('/_api/v3/pages?access_token=secret&foo=bar'),
    ).toBe('/_api/v3/pages');
  });

  it('drops a query string that is present but empty', () => {
    expect(sanitizeEndpointForIndex('/_api/v3/pages?')).toBe('/_api/v3/pages');
  });

  it('returns an empty string when nothing is left of the path', () => {
    expect(sanitizeEndpointForIndex('?access_token=secret')).toBe('');
    expect(sanitizeEndpointForIndex('')).toBe('');
  });
});
