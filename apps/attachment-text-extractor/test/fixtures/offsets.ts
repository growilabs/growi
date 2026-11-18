/** Where each of a run of consecutive chunks starts, the first at `start`. */
export const startOffsets = (
  start: number,
  lengths: readonly number[],
): number[] => {
  let next = start;
  return lengths.map((length) => {
    const offset = next;
    next += length;
    return offset;
  });
};
