import { notDeepEqual } from 'assert';

import { attributes, tagNames } from './recommended-whitelist';

describe('recommended-whitelist', () => {
  test('.tagNames should return iframe tag', () => {
    expect(tagNames).not.toBeNull();
    expect(tagNames).includes('iframe');
  });

  test('.tagNames should return video tag', () => {
    expect(tagNames).not.toBeNull();
    expect(tagNames).includes('video');
  });

  test('.attributes should return data attributes', () => {
    expect(attributes).not.toBeNull();

    assert(attributes != null);

    expect(Object.keys(attributes)).includes('*');
    expect(attributes['*']).includes('alt');
    expect(attributes['*']).includes('align');
    expect(attributes['*']).includes('width');
    expect(attributes['*']).includes('height');
    expect(attributes['*']).includes('className');
    expect(attributes['*']).includes('data*');
  });

  test('.attributes should return iframe attributes', () => {
    expect(attributes).not.toBeNull();

    assert(attributes != null);

    expect(Object.keys(attributes)).includes('iframe');
    expect(attributes.iframe).includes('src');
  });

  test('.attributes should return video attributes', () => {
    expect(attributes).not.toBeNull();

    assert(attributes != null);

    expect(Object.keys(attributes)).includes('video');
    expect(attributes.iframe).includes('src');
  });

  test('.attributes.a should allow class and className by excluding partial className specification', () => {
    expect(attributes).not.toBeNull();

    assert(attributes != null);

    expect(Object.keys(attributes)).includes('a');
    expect(attributes.a).not.toContainEqual([
      'className',
      'data-footnote-backref',
    ]);
  });

  test('.attributes.ul should allow class and className by excluding partial className specification', () => {
    expect(attributes).not.toBeNull();

    assert(attributes != null);

    expect(Object.keys(attributes)).includes('a');
    expect(attributes.a).not.toContainEqual([
      'className',
      'data-footnote-backref',
    ]);
  });

  test('.attributes.li should allow class and className by excluding partial className specification', () => {
    expect(attributes).not.toBeNull();

    assert(attributes != null);

    expect(Object.keys(attributes)).includes('a');
    expect(attributes.a).not.toContainEqual([
      'className',
      'data-footnote-backref',
    ]);
  });
});
