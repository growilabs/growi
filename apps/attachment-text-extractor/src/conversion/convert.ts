import type { ConversionLimits, ConversionOutcome } from '../contract';

export const convert = (
  _bytes: Uint8Array,
  _fileName: string,
  _mimeHint: string | null,
  _limits: ConversionLimits,
): Promise<ConversionOutcome> =>
  Promise.reject(new Error('not implemented: conversion/convert.convert'));
