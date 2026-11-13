import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { LEGACY_DOC_PATH, LEGACY_PPT_PATH } from './legacy';
import { anydocMarkdown, readLegacyProvenanceSha256 } from './spec-support';

describe('legacy DOC / PPT fixtures', () => {
  it('match the SHA-256 recorded in PROVENANCE.md', () => {
    const recorded = readLegacyProvenanceSha256();

    for (const path of [LEGACY_DOC_PATH, LEGACY_PPT_PATH]) {
      const actual = createHash('sha256')
        .update(readFileSync(path))
        .digest('hex');
      expect(recorded[basename(path)]).toBe(actual);
    }
  });

  it('convert to the text PROVENANCE.md describes', async () => {
    const doc = await anydocMarkdown(readFileSync(LEGACY_DOC_PATH), 'doc');
    const ppt = await anydocMarkdown(readFileSync(LEGACY_PPT_PATH), 'ppt');

    expect(doc).toContain('Cell 1,1');
    expect(doc).toContain('This text is below the table.');
    expect(ppt).toContain('Title Placeholder');
    expect(ppt).toContain('Octagon');
  });
});
