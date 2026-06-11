// Mark dist/cjs as CommonJS so Node does not interpret its .js files as ESM
// (the package root declares "type": "module").
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync(new URL('../dist/cjs', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../dist/cjs/package.json', import.meta.url),
  '{ "type": "commonjs" }\n',
);
