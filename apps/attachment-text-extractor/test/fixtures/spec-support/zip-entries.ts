import CFB from 'cfb';

const STREAM_ENTRY_TYPE = 2;
const ROOT_PREFIX = 'Root Entry/';
// cfb inserts this placeholder stream into every container it reads.
const CFB_PLACEHOLDER = '\u0001Sh33tJ5';

/**
 * Reads a ZIP with cfb's independent ZIP parser (not our writer's code), so a
 * spec that reads back what a generator wrote is a real round trip.
 */
export const readZipEntries = (zip: Uint8Array): Map<string, Buffer> => {
  const container = CFB.read(zip, { type: 'buffer' });
  const entries = container.FullPaths.flatMap((fullPath, index) => {
    const entry = container.FileIndex[index];
    const name = fullPath.slice(ROOT_PREFIX.length);
    if (entry.type !== STREAM_ENTRY_TYPE || name === CFB_PLACEHOLDER) {
      return [];
    }
    return [[name, Buffer.from(entry.content)] as const];
  });
  return new Map(entries);
};

export const readZipText = (zip: Uint8Array, name: string): string => {
  const data = readZipEntries(zip).get(name);
  if (data == null) {
    throw new Error(`no ZIP entry named ${name}`);
  }
  return data.toString('utf8');
};
