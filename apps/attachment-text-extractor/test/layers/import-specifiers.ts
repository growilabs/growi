import ts from 'typescript';

// The compiler's own pre-processor. It sees static imports, `import type`,
// re-exports, `import x = require()`, `import()` with a plain string or
// template literal, and calls of an identifier named `require`; it does not
// see `createRequire(import.meta.url)('…')` called in one expression.
export const extractImportSpecifiers = (source: string): readonly string[] =>
  ts
    .preProcessFile(source, true, true)
    .importedFiles.map((file) => file.fileName);
