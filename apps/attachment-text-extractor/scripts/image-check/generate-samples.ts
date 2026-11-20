// CLI: `generate-samples.ts --out-dir <dir>` writes the image check's sample
// documents, and prints one line per sample: file name, MIME type, marker
// (tab-separated), for the shell script that sends them.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { SAMPLES } from './samples';

const { values } = parseArgs({ options: { 'out-dir': { type: 'string' } } });
const outDir = values['out-dir'];
if (outDir === undefined || outDir === '') {
  process.stderr.write('usage: generate-samples.ts --out-dir <dir>\n');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
for (const { fileName, mimeType, marker, build } of SAMPLES) {
  writeFileSync(path.join(outDir, fileName), build());
  process.stdout.write(`${fileName}\t${mimeType}\t${marker}\n`);
}
