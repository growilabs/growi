// yazl's validateMetadataPath: it refuses these names, and turns '\' into '/'
// (which would rename the entry), so they are left out of a rewritten package.
// anydoc reads only the parts the package relationships reach.
const DRIVE_LETTER = /^[A-Za-z]:/;
// yazl's 16-bit name length field.
const MAX_NAME_BYTES = 0xffff;

export const isWritableEntryName = (name: string): boolean =>
  name !== '' &&
  !name.includes('\\') &&
  !name.startsWith('/') &&
  !DRIVE_LETTER.test(name) &&
  !name.endsWith('/') &&
  !name.split('/').includes('..') &&
  Buffer.byteLength(name, 'utf8') <= MAX_NAME_BYTES;
