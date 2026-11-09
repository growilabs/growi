import type { Readable, Writable } from 'node:stream';

import type { ConversionOutcome } from '../contract';

export class WireProtocolError extends Error {}

export const encodeFrameHeader = (_length: number): Buffer => {
  throw new Error(
    'not implemented: wire/length-prefixed-json.encodeFrameHeader',
  );
};

export const readFrame = (
  _stream: Readable,
  _maxLength: number,
): Promise<Buffer> =>
  Promise.reject(
    new Error('not implemented: wire/length-prefixed-json.readFrame'),
  );

export const writeFrame = (
  _stream: Writable,
  _body: Uint8Array,
): Promise<void> =>
  Promise.reject(
    new Error('not implemented: wire/length-prefixed-json.writeFrame'),
  );

export const maxResultFrameBytes = (_maxResultBytes: number): number => {
  throw new Error(
    'not implemented: wire/length-prefixed-json.maxResultFrameBytes',
  );
};

export const encodeResult = (_outcome: ConversionOutcome): Buffer => {
  throw new Error('not implemented: wire/length-prefixed-json.encodeResult');
};

export const decodeResult = (_body: Uint8Array): ConversionOutcome => {
  throw new Error('not implemented: wire/length-prefixed-json.decodeResult');
};
