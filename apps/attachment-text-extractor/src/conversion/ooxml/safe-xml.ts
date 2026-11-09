import type { Document } from '@xmldom/xmldom';

export const parseXmlPart = (_bytes: Uint8Array, _label: string): Document => {
  throw new Error('not implemented: conversion/ooxml/safe-xml.parseXmlPart');
};

export const serializeXmlPart = (_document: Document): Buffer => {
  throw new Error(
    'not implemented: conversion/ooxml/safe-xml.serializeXmlPart',
  );
};
