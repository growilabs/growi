import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROVENANCE_PATH = fileURLToPath(
  new URL('../legacy/PROVENANCE.md', import.meta.url),
);

/** File name -> SHA-256, as recorded in legacy/PROVENANCE.md. */
export const readLegacyProvenanceSha256 = (): Record<string, string> => {
  const provenance = readFileSync(PROVENANCE_PATH, 'utf8');
  const rows = provenance.matchAll(
    /^\| `([^`]+)` \|.*\| `([0-9a-f]{64})` \|$/gm,
  );
  return Object.fromEntries([...rows].map((row) => [row[1], row[2]]));
};
