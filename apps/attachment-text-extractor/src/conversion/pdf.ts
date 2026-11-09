import type { ConversionLimits, PageInfo } from '../contract';

export const convertPdf = (
  _bytes: Uint8Array,
  _limits: ConversionLimits,
): Promise<readonly PageInfo[]> =>
  Promise.reject(new Error('not implemented: conversion/pdf.convertPdf'));
