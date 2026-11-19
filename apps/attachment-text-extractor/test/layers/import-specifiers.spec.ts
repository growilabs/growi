import { extractImportSpecifiers } from './import-specifiers';

describe('extractImportSpecifiers', () => {
  it('reads static, type-only, side-effect and re-export forms but not comments', () => {
    const source = [
      "// import { c } from './commented';",
      "import { a } from './a';",
      "import type { B } from '../b';",
      "import './side-effect';",
      "export * from './c';",
    ].join('\n');

    expect(extractImportSpecifiers(source)).toEqual([
      './a',
      '../b',
      './side-effect',
      './c',
    ]);
  });

  it.each([
    ['import()', "const f = () => import('../conversion');"],
    ['template-literal import()', 'const f = () => import(`../conversion`);'],
    ['import x = require()', "import x = require('../conversion');"],
    [
      'an import after another statement',
      "const a = 1; import b from '../conversion';",
    ],
    ['an import without whitespace', "import{a}from'../conversion';"],
    ['a string-named binding', "import { 'a b' as c } from '../conversion';"],
    ['a require() call', "const m = require('../conversion');"],
  ])('reads %s', (_name, source) => {
    expect(extractImportSpecifiers(source)).toEqual(['../conversion']);
  });
});
