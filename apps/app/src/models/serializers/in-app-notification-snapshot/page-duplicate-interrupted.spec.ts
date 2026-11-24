import {
  type PageDuplicateInterruptedSnapshot,
  pageDuplicateInterruptedSnapshot,
} from './page-duplicate-interrupted';

const valid: PageDuplicateInterruptedSnapshot = {
  path: '/to/copy',
  fromPath: '/from',
  toPath: '/to/copy',
  copiedPageCount: 3,
  sourcePageCount: 10,
};

describe('pageDuplicateInterruptedSnapshot', () => {
  it('parses back what stringify produced', () => {
    const text = pageDuplicateInterruptedSnapshot.stringify(valid);
    expect(pageDuplicateInterruptedSnapshot.parse(text)).toEqual(valid);
  });

  it('accepts zero counts', () => {
    const zero = { ...valid, copiedPageCount: 0, sourcePageCount: 0 };
    const text = pageDuplicateInterruptedSnapshot.stringify(zero);
    expect(pageDuplicateInterruptedSnapshot.parse(text)).toEqual(zero);
  });

  it.each([
    ['not JSON', 'not json'],
    ['empty string', ''],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['JSON string', '"x"'],
    ['empty object', '{}'],
    ['another notification snapshot', JSON.stringify({ path: '/only/path' })],
  ])('returns undefined for %s', (_label, text) => {
    expect(pageDuplicateInterruptedSnapshot.parse(text)).toBeUndefined();
  });

  it.each(
    Object.keys(valid).map((key) => [key]),
  )('returns undefined when %s is missing', (key) => {
    const { [key]: _omitted, ...rest } = { ...valid } as Record<
      string,
      unknown
    >;
    expect(
      pageDuplicateInterruptedSnapshot.parse(JSON.stringify(rest)),
    ).toBeUndefined();
  });

  it.each([
    ['path', 1],
    ['fromPath', null],
    ['toPath', {}],
    ['copiedPageCount', '3'],
    ['sourcePageCount', null],
    ['copiedPageCount', -1],
    ['sourcePageCount', 1.5],
  ])('returns undefined when %s has the wrong value (%s)', (key, value) => {
    const text = JSON.stringify({ ...valid, [key]: value });
    expect(pageDuplicateInterruptedSnapshot.parse(text)).toBeUndefined();
  });
});
