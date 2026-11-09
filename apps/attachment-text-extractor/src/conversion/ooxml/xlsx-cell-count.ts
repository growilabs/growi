import type { ConversionLimits } from '../../contract';
import type { OoxmlArchive } from './archive-guard';

export const enforceCellLimit = (
  _archive: OoxmlArchive,
  _limits: Pick<
    ConversionLimits,
    'maxXlsxCells' | 'maxArchiveUncompressedBytes'
  >,
): Promise<void> =>
  Promise.reject(
    new Error(
      'not implemented: conversion/ooxml/xlsx-cell-count.enforceCellLimit',
    ),
  );
