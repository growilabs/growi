import assert from 'assert';

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

  // Tests for restored semantic HTML tags
  describe('semantic HTML tags restored from v6.3.5', () => {
    test('.tagNames should include abbr tag', () => {
      expect(tagNames).toContain('abbr');
    });

    test('.tagNames should include bdo tag', () => {
      expect(tagNames).toContain('bdo');
    });

    test('.tagNames should include caption tag', () => {
      expect(tagNames).toContain('caption');
    });

    test('.tagNames should include cite tag', () => {
      expect(tagNames).toContain('cite');
    });

    test('.tagNames should include dfn tag', () => {
      expect(tagNames).toContain('dfn');
    });

    test('.tagNames should include figure tag', () => {
      expect(tagNames).toContain('figure');
    });

    test('.tagNames should include figcaption tag', () => {
      expect(tagNames).toContain('figcaption');
    });

    test('.tagNames should include mark tag', () => {
      expect(tagNames).toContain('mark');
    });

    test('.tagNames should include small tag', () => {
      expect(tagNames).toContain('small');
    });

    test('.tagNames should include time tag', () => {
      expect(tagNames).toContain('time');
    });

    test('.tagNames should include wbr tag', () => {
      expect(tagNames).toContain('wbr');
    });
  });

  describe('attributes for semantic HTML tags', () => {
    test('.attributes should have abbr with title attribute', () => {
      expect(attributes).not.toBeNull();
      assert(attributes != null);
      expect(Object.keys(attributes)).toContain('abbr');
      expect(attributes.abbr).toContain('title');
    });

    test('.attributes should have bdo with dir attribute', () => {
      expect(attributes).not.toBeNull();
      assert(attributes != null);
      expect(Object.keys(attributes)).toContain('bdo');
      expect(attributes.bdo).toContain('dir');
    });

    test('.attributes should have dfn with title attribute', () => {
      expect(attributes).not.toBeNull();
      assert(attributes != null);
      expect(Object.keys(attributes)).toContain('dfn');
      expect(attributes.dfn).toContain('title');
    });

    test('.attributes should have time with datetime attribute', () => {
      expect(attributes).not.toBeNull();
      assert(attributes != null);
      expect(Object.keys(attributes)).toContain('time');
      expect(attributes.time).toContain('datetime');
    });

    test('.attributes should have empty arrays for tags without specific attributes', () => {
      expect(attributes).not.toBeNull();

      // Tags that should have empty attribute arrays
      const tagsWithEmptyAttributes = [
        'caption',
        'cite',
        'figure',
        'figcaption',
        'mark',
        'small',
        'wbr',
      ];

      tagsWithEmptyAttributes.forEach((tag) => {
        assert(attributes != null);

        expect(Object.keys(attributes)).toContain(tag);
        expect(attributes[tag]).toEqual([]);
      });
    });
  });
});
