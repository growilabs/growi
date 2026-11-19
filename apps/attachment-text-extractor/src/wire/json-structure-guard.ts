import { WireProtocolError } from './wire-protocol-error';

const PLAIN_RUN = /[^"\\]*/y;

/**
 * The only containers a result has: one top-level object, one level of arrays in it, and objects
 * as the elements of those arrays.
 */
export interface ResultSkeleton {
  /** Every key the top-level object may use. */
  readonly topKeys: readonly string[];
  /** The keys every array element has, all of them. */
  readonly elementKeys: readonly string[];
}

const TOP_DEPTH = 1;
const ELEMENT_DEPTH = 3;
const BETWEEN_ELEMENTS = new Set(['{', ',', ']', ' ', '\t', '\n', '\r']);

// Index just past the closing quote of the string literal that opens at `start`.
// A regex for the whole literal would recurse once per escape and overflow the stack on text with many "\n".
const endOfString = (json: string, start: number): number => {
  let index = start + 1;
  for (;;) {
    if (index >= json.length) {
      return json.length;
    }
    PLAIN_RUN.lastIndex = index;
    PLAIN_RUN.test(json);
    index = PLAIN_RUN.lastIndex;
    if (json[index] !== '\\') {
      return index + 1;
    }
    index += 2;
  }
};

/**
 * Runs before JSON.parse, on text that may not be valid JSON, so it only tracks structure and never
 * assumes well-formedness. Whatever is not part of the skeleton is refused where it starts: parsing
 * it first costs the parent far more memory than the frame (research.md 27.13). JSON.parse also
 * keeps the last of two equal keys, which would let a child hide a field from the checks, hence the
 * duplicate-key refusal.
 */
export const rejectUnsafeStructure = (
  json: string,
  skeleton: ResultSkeleton,
): void => {
  const topKeys = new Set(skeleton.topKeys);
  const elementKeys = new Set(skeleton.elementKeys);
  // One entry per open container: the keys seen so far in an object, or null for an array.
  const containers: (Set<string> | null)[] = [];
  let expectKey = false;
  let index = 0;

  while (index < json.length) {
    const char = json.charAt(index);
    const depth = containers.length;
    const open = containers[depth - 1];
    if (open === null && !BETWEEN_ELEMENTS.has(char)) {
      throw new WireProtocolError('result array holds a non-object');
    }
    if (char === '"') {
      const end = endOfString(json, index);
      if (expectKey && open != null) {
        // A slice that opens with a quote parses to a string or throws.
        const key: string = JSON.parse(json.slice(index, end));
        if (open.has(key)) {
          throw new WireProtocolError('duplicate key in result');
        }
        const allowed = depth === TOP_DEPTH ? topKeys : elementKeys;
        if (!allowed.has(key)) {
          throw new WireProtocolError('unexpected key in result');
        }
        open.add(key);
        expectKey = false;
      }
      index = end;
      continue;
    }
    if (char === '{') {
      if (depth !== 0 && open !== null) {
        throw new WireProtocolError('result has an object inside an object');
      }
      containers.push(new Set());
      expectKey = true;
    } else if (char === '[') {
      if (depth !== TOP_DEPTH) {
        throw new WireProtocolError('result has an array outside its object');
      }
      containers.push(null);
      expectKey = false;
    } else if (char === '}' || char === ']') {
      if (
        char === '}' &&
        depth === ELEMENT_DEPTH &&
        open?.size !== elementKeys.size
      ) {
        throw new WireProtocolError('result array element lacks a key');
      }
      containers.pop();
      expectKey = false;
    } else if (char === ',') {
      expectKey = open != null;
    }
    index += 1;
  }
};
