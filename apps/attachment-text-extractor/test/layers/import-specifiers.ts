import ts from 'typescript';

// The compiler's own pre-processor, so every form that loads a module is seen
// (static, `import type`, re-export, `import x = require()`, `import()` with a
// plain string or template literal, `require()` calls).
export const extractImportSpecifiers = (source: string): readonly string[] =>
  ts
    .preProcessFile(source, true, true)
    .importedFiles.map((file) => file.fileName);
