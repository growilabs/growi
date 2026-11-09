import type { AnydocFormat } from '../formats/format-table';

export const convertOffice = (
  _bytes: Uint8Array,
  _format: AnydocFormat,
): Promise<string> =>
  Promise.reject(new Error('not implemented: conversion/office.convertOffice'));
