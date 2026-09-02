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

import {
  type BareItem,
  type Item,
  type Parameters,
  parseDictionary,
  serializeDictionary,
  serializeInnerList,
} from 'structured-headers';

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

/**
 * Reads an RFC 8941 Dictionary whose every member is a bare Byte Sequence --
 * the shape both RFC 9530's `Content-Digest` and RFC 9421's `Signature` take.
 *
 * Returns `null` rather than throwing for anything that is not that shape.
 * These values arrive from the network, so a caller (`verify`) has to answer
 * with a failure instead of an exception (requirement 10.2), and a `try` at
 * every call site would put that burden back on the callers this wrapper
 * exists to keep away from the library.
 */
export const parseByteSequenceDictionary = (
  value: string,
): ReadonlyMap<string, Uint8Array> | null => {
  let dictionary: ReturnType<typeof parseDictionary>;
  try {
    dictionary = parseDictionary(value);
  } catch {
    return null;
  }

  const result = new Map<string, Uint8Array>();
  for (const [key, member] of dictionary) {
    const [bare] = member;
    if (Array.isArray(bare) || !(bare instanceof ArrayBuffer)) {
      return null;
    }
    result.set(key, new Uint8Array(bare));
  }
  return result;
};

/** One member of a Dictionary of Inner Lists, with its parameters in sent order. */
export interface ParsedStringInnerList {
  readonly members: readonly string[];
  readonly parameters: ReadonlyMap<string, number | string>;
}

const toNarrowParameters = (
  parameters: Parameters,
): ReadonlyMap<string, number | string> | null => {
  const narrowed = new Map<string, number | string>();
  for (const [key, value] of parameters) {
    if (typeof value !== 'number' && typeof value !== 'string') {
      return null;
    }
    narrowed.set(key, value);
  }
  return narrowed;
};

/**
 * Reads an RFC 8941 Dictionary whose every member is an Inner List of bare
 * Strings with parameters -- the shape RFC 9421's `Signature-Input` takes.
 *
 * **The parameters keep the order they were sent in.** The verifying side has
 * to rebuild the signature base from exactly what arrived (RFC 9421 section
 * 3.2 step 7); re-ordering them here would reject a peer that serializes them
 * differently. Returns `null` for anything that is not this shape, for the
 * same reason as {@link parseByteSequenceDictionary}.
 */
export const parseStringInnerListDictionary = (
  value: string,
): ReadonlyMap<string, ParsedStringInnerList> | null => {
  let dictionary: ReturnType<typeof parseDictionary>;
  try {
    dictionary = parseDictionary(value);
  } catch {
    return null;
  }

  const result = new Map<string, ParsedStringInnerList>();
  for (const [key, member] of dictionary) {
    const [inner, parameters] = member;
    if (!Array.isArray(inner)) {
      return null;
    }

    const members: string[] = [];
    for (const item of inner as Item[]) {
      const bare: BareItem = item[0];
      if (typeof bare !== 'string') {
        return null;
      }
      members.push(bare);
    }

    const narrowed = toNarrowParameters(parameters);
    if (narrowed == null) {
      return null;
    }
    result.set(key, { members, parameters: narrowed });
  }
  return result;
};
