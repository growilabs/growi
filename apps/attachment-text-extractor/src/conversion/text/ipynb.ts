/** The cap on one cell output's text; convert() passes it, ConversionLimits does not carry it. */
export const IPYNB_OUTPUT_MAX_CHARS = 10_000;

export const ipynbToText = (
  _bytes: Uint8Array,
  _outputMaxChars: number,
): string => {
  throw new Error('not implemented: conversion/text/ipynb.ipynbToText');
};
