import { batchProcessPromiseAll } from './promise';

describe('batchProcessPromiseAll', () => {
  it('processes items in batch', async () => {
    const batch1 = [1, 2, 3, 4, 5];
    const batch2 = [6, 7, 8, 9, 10];
    const batch3 = [11, 12];
    const all = [...batch1, ...batch2, ...batch3];

    const actualProcessedBatches: number[][] = [];
    const result = await batchProcessPromiseAll(all, 5, async (num, i, arr) => {
      if (arr != null && i === 0) {
        actualProcessedBatches.push(arr);
      }
      return num * 10;
    });

    const expected = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

    expect(result).toStrictEqual(expected);
    expect(actualProcessedBatches).toStrictEqual([batch1, batch2, batch3]);
  });

  describe('error handling', () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8, '9', 10];

    const multiplyBy10 = async (num) => {
      if (typeof num !== 'number') {
        throw new Error('Is not number');
      }
      return num * 10;
    };

    describe('when throwIfRejected is true', () => {
      it('throws error when there is a Promise rejection', async () => {
        await expect(
          batchProcessPromiseAll(all, 5, multiplyBy10),
        ).rejects.toThrow('Is not number');
      });
    });

    describe('when throwIfRejected is false', () => {
      it("doesn't throw error when there is a Promise rejection", async () => {
        const expected = [10, 20, 30, 40, 50, 60, 70, 80, 100];
        await expect(
          batchProcessPromiseAll(all, 5, multiplyBy10, false),
        ).resolves.toStrictEqual(expected);
      });
    });
  });
});
