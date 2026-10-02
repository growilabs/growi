import type { Stats } from 'fs';

export type ZipFileStat = {
  meta: object;
  fileName: string;
  zipFilePath: string;
  fileStat: Stats;
  innerFileStats: {
    fileName: string;
    collectionName: string;
    size: number;
  }[];
};
