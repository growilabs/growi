import { LinkedPagePath } from '~/models/linked-page-path';

import { buildLinkedPagePathHref } from './build-linked-page-path-href';

describe('buildLinkedPagePathHref', () => {
  it('returns the node path as-is when no base path is given', () => {
    expect(buildLinkedPagePathHref(new LinkedPagePath('/A/B'))).toBe('/A/B');
  });

  it('returns "/" for the root node', () => {
    expect(buildLinkedPagePathHref(new LinkedPagePath('/'))).toBe('/');
  });

  it('joins the node path onto a base path', () => {
    expect(buildLinkedPagePathHref(new LinkedPagePath('/A/B'), '/base')).toBe(
      '/base/A/B',
    );
  });

  it('percent-encodes non-ASCII characters and spaces', () => {
    expect(buildLinkedPagePathHref(new LinkedPagePath('/日本語/a b'))).toBe(
      '/%E6%97%A5%E6%9C%AC%E8%AA%9E/a%20b',
    );
  });
});
