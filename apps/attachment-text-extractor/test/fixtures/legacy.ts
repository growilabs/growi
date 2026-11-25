import { fileURLToPath } from 'node:url';

// Committed Apache POI files: the only fixtures that are not generated
// (design.md D5). Source and license are in legacy/PROVENANCE.md.

const legacyPath = (fileName: string): string =>
  fileURLToPath(new URL(`./legacy/${fileName}`, import.meta.url));

export const LEGACY_DOC_PATH = legacyPath('simple-table.doc');
export const LEGACY_PPT_PATH = legacyPath('text_shapes.ppt');
