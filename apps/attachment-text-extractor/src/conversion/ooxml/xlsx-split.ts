import type { ConversionLimits, PageInfo } from '../../contract';

export const convertXlsx = (
  _bytes: Uint8Array,
  _limits: ConversionLimits,
): Promise<readonly PageInfo[]> =>
  Promise.reject(
    new Error('not implemented: conversion/ooxml/xlsx-split.convertXlsx'),
  );
