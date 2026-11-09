import type { ConversionLimits, PageInfo } from '../../contract';

export const convertPptx = (
  _bytes: Uint8Array,
  _limits: ConversionLimits,
): Promise<readonly PageInfo[]> =>
  Promise.reject(
    new Error('not implemented: conversion/ooxml/pptx-split.convertPptx'),
  );
