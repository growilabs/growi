import type { Readable } from 'node:stream';

import type { ConversionLimits } from '../../contract';

export type ArchiveLimits = Pick<
  ConversionLimits,
  'maxArchiveEntries' | 'maxArchiveUncompressedBytes'
>;

export interface ArchiveEntry {
  readonly name: string;
  readonly declaredSize: number;
  readonly isDirectory: boolean;
}

export interface OoxmlArchive {
  /** In central directory order, duplicate names included. */
  readonly entries: readonly ArchiveEntry[];
  readPart(name: string, maxBytes: number): Promise<Buffer>;
  openEntry(entry: ArchiveEntry): Promise<Readable>;
  close(): void;
}

/** null when the bytes are not a ZIP holding `requiredPart`. */
export const inspectArchive = (
  _bytes: Uint8Array,
  _requiredPart: string,
  _limits: ArchiveLimits,
): Promise<OoxmlArchive | null> =>
  Promise.reject(
    new Error('not implemented: conversion/ooxml/archive-guard.inspectArchive'),
  );
