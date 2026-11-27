export const chunkRevisionIds = (
  ids: readonly string[],
  size: number,
): readonly (readonly string[])[] => {
  const sorted = [...new Set(ids)].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < sorted.length; i += size) {
    chunks.push(sorted.slice(i, i + size));
  }
  return chunks;
};
