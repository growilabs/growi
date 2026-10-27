import {
  combineNamespaceContents,
  extractNamespaceContent,
  wrapSingleNamespace,
} from './namespace-envelope';

describe('combineNamespaceContents', () => {
  it('combines multiple namespace entries into a single JSON keyed by namespace name', () => {
    const result = combineNamespaceContents([
      { namespace: 'admin', content: { title: 'Admin' } },
      { namespace: 'commons', content: { save: 'Save' } },
    ]);

    expect(result).toEqual({
      admin: { title: 'Admin' },
      commons: { save: 'Save' },
    });
  });
});

describe('wrapSingleNamespace', () => {
  it('wraps a single namespace content under the namespace name as the sole key', () => {
    const result = wrapSingleNamespace('translation', { hello: 'Hello' });

    expect(result).toEqual({ translation: { hello: 'Hello' } });
  });
});

describe('extractNamespaceContent', () => {
  it('returns the content of an existing namespace', () => {
    const combined = { admin: { title: 'Admin' }, commons: { save: 'Save' } };

    const result = extractNamespaceContent(combined, 'admin');

    expect(result).toEqual({ title: 'Admin' });
  });

  it('returns an empty object when the target namespace key is absent, without throwing', () => {
    const combined = { admin: { title: 'Admin' } };

    const result = extractNamespaceContent(combined, 'commons');

    expect(result).toEqual({});
  });

  it('returns an empty object when the value at the namespace key is not an object', () => {
    const combined = { admin: 'not-an-object' };

    const result = extractNamespaceContent(combined, 'admin');

    expect(result).toEqual({});
  });
});
