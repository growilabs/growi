import fs from 'node:fs';
import path from 'node:path';

import { describe, test, expect } from 'vitest';

import migrations from './remark-growi-directive';

describe('remark-growi-directive migrations', () => {
  test('should transform example.md to match example-expected.md', () => {
    const input = fs.readFileSync(path.join(__dirname, 'example.md'), 'utf8');
    const expected = fs.readFileSync(path.join(__dirname, 'example-expected.md'), 'utf8');

    const result = migrations.reduce((text, migration) => migration(text), input);
    expect(result).toBe(expected);
  });

  test('should not modify example-expected.md', () => {
    const input = fs.readFileSync(path.join(__dirname, 'example-expected.md'), 'utf8');

    const result = migrations.reduce((text, migration) => migration(text), input);
    expect(result).toBe(input);
  });

  test('should handle various directive patterns', () => {
    const input = `
<div>
    $foo(filter=(AAA))
    $bar-2(except=(BBB))
    $baz_3(filter=(CCC), except=(DDD))
</div>`;

    const expected = `
<div>

$foo(filter=AAA)
$bar-2(except=BBB)
$baz_3(filter=CCC, except=DDD)
</div>`;

    const result = migrations.reduce((text, migration) => migration(text), input);
    expect(result).toBe(expected);
  });
});
