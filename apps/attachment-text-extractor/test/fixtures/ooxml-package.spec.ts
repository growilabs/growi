import { editPart, replaceOrThrow } from './ooxml-package';

describe('editPart', () => {
  const parts = [
    { name: 'a.xml', data: '<a/>' },
    { name: 'b.xml', data: Buffer.from('<b/>') },
  ];

  it('rewrites the named part, text or bytes, and keeps the others and the input as they are', () => {
    const edited = editPart(parts, 'b.xml', (text) => `${text}<!-- edited -->`);

    expect(edited).toEqual([
      { name: 'a.xml', data: '<a/>' },
      { name: 'b.xml', data: '<b/><!-- edited -->' },
    ]);
    expect(parts[1].data).toEqual(Buffer.from('<b/>'));
  });

  it('refuses a part name that is not there, instead of returning the parts unchanged', () => {
    expect(() => editPart(parts, 'missing.xml', (text) => text)).toThrow(
      'missing.xml',
    );
  });
});

describe('replaceOrThrow', () => {
  it('replaces like String.prototype.replace', () => {
    expect(replaceOrThrow('a-b-b', /b/g, 'c')).toBe('a-c-c');
    expect(replaceOrThrow('a-b-b', 'b', 'c')).toBe('a-c-b');
  });

  it('throws when the pattern does not match', () => {
    expect(() => replaceOrThrow('abc', /z/, 'y')).toThrow();
  });
});
