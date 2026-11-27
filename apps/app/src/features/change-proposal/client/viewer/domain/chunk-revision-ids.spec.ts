import { chunkRevisionIds } from './chunk-revision-ids';

const makeIds = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `rev-${String(i).padStart(4, '0')}`);

describe('chunkRevisionIds', () => {
  it('returns no chunks for empty input', () => {
    expect(chunkRevisionIds([], 100)).toEqual([]);
  });

  it('removes duplicate ids', () => {
    expect(chunkRevisionIds(['b', 'a', 'b', 'a', 'a'], 100)).toEqual([
      ['a', 'b'],
    ]);
  });

  it('sorts ids in ascending order', () => {
    expect(chunkRevisionIds(['c', 'a', 'b'], 100)).toEqual([['a', 'b', 'c']]);
  });

  it('produces the same chunks regardless of input order', () => {
    const ids = makeIds(150);
    const shuffled = [...ids].reverse();

    expect(chunkRevisionIds(shuffled, 100)).toEqual(chunkRevisionIds(ids, 100));
  });

  it.each([
    { count: 99, sizes: [99] },
    { count: 100, sizes: [100] },
    { count: 101, sizes: [100, 1] },
    { count: 200, sizes: [100, 100] },
    { count: 201, sizes: [100, 100, 1] },
  ])('splits $count ids into chunks of $sizes', ({ count, sizes }) => {
    const ids = makeIds(count);

    const chunks = chunkRevisionIds(ids, 100);

    expect(chunks.map((chunk) => chunk.length)).toEqual(sizes);
    expect(chunks.flat()).toEqual(ids);
  });

  it('counts only distinct ids toward the chunk size', () => {
    const ids = [...makeIds(100), ...makeIds(100)];

    expect(chunkRevisionIds(ids, 100).map((c) => c.length)).toEqual([100]);
  });

  it('does not mutate the input', () => {
    const ids = ['b', 'a', 'b'];

    chunkRevisionIds(ids, 100);

    expect(ids).toEqual(['b', 'a', 'b']);
  });
});
