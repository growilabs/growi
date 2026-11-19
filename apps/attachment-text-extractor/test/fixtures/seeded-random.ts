// Python's random.Random(seed) sequence cannot be reproduced in Node; the
// tests only need bytes that are fixed per seed and do not compress
// (research.md 9.7), so a small seeded generator (mulberry32) is enough.

const nextUint32 = (state: number): [next: number, value: number] => {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [next, (t ^ (t >>> 14)) >>> 0];
};

/**
 * Returns a function that hands out the next `length` bytes of the sequence
 * for `seed` on each call, so consecutive calls continue one stream.
 */
export const createRandomBytes = (
  seed: number,
): ((length: number) => Buffer) => {
  let state = seed | 0;
  return (length: number): Buffer => {
    const bytes = Buffer.alloc(Math.ceil(length / 4) * 4);
    for (let at = 0; at < bytes.length; at += 4) {
      const [next, value] = nextUint32(state);
      state = next;
      bytes.writeUInt32LE(value, at);
    }
    return bytes.subarray(0, length);
  };
};
