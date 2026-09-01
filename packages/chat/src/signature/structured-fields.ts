// The single point of contact with `structured-headers` (design.md
// "Allowed Dependencies": this file, and only this file, touches that
// library's API).
//
// The library does ship declaration files, but its types describe the whole
// of RFC 8941: `BareItem` is a seven-way union and a `Dictionary` member may
// also be an Inner List. Handing that surface to the rest of `signature/`
// would push a runtime narrowing burden onto every caller. This wrapper
// therefore exposes a narrow, purpose-built API -- the exact shapes this
// package's HTTP header values take -- so the callers stay free of both the
// union and the library.

import { serializeDictionary, serializeInnerList } from 'structured-headers';

/**
 * A Structured Fields Dictionary (RFC 8941 section 3.2) whose every member is
 * a bare Byte Sequence with no parameters -- the shape RFC 9530's
 * `Content-Digest` uses. Order is the serialized member order.
 */
export type ByteSequenceDictionary = ReadonlyMap<string, Uint8Array>;

/**
 * Copies the bytes the view covers into a standalone ArrayBuffer.
 *
 * The library serializes a Byte Sequence only from an `ArrayBuffer`, and it
 * reads the buffer whole. This function accepts any `Uint8Array`, and a
 * caller may legitimately pass a view into a larger backing buffer (e.g. a
 * slice of a bigger read buffer) -- passing `.buffer` straight through in
 * that case would serialize the surrounding bytes alongside the intended
 * value.
 */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  new Uint8Array(bytes).buffer;

/** Serializes to an RFC 8941 Dictionary header value, e.g. `sha-512=:<base64>:`. */
export const serializeByteSequenceDictionary = (
  dictionary: ByteSequenceDictionary,
): string =>
  serializeDictionary(
    new Map(
      [...dictionary].map(([key, bytes]) => [
        key,
        [toArrayBuffer(bytes), new Map()],
      ]),
    ),
  );

/**
 * The parameters of an RFC 8941 Inner List, in serialization order. The value
 * shapes are the two this package uses: an Integer and a String.
 */
export type InnerListParameters = ReadonlyMap<string, number | string>;

/**
 * Serializes an RFC 8941 Inner List (section 4.1.1.1) whose members are all
 * bare Strings, followed by its parameters -- the shape RFC 9421's
 * `@signature-params` takes, e.g. `("@method" "content-type");created=1;keyid="k"`.
 */
export const serializeStringInnerList = (
  members: readonly string[],
  parameters: InnerListParameters,
): string =>
  serializeInnerList([
    members.map((member) => [member, new Map()]),
    new Map(parameters),
  ]);
