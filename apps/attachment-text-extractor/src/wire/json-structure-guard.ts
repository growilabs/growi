import { WireProtocolError } from './wire-protocol-error';

const PLAIN_RUN = /[^"\\]*/y;

// A real result is three levels deep (outer object, pages array, page object); anything deeper is
// refused by the shape checks anyway. JSON.parse has no depth limit and builds the whole structure,
// so a nesting bomb that fits in the frame would cost the parent gigabytes before any check ran.
const MAX_DEPTH = 64;

// Every object in a valid result has exactly three keys; the same reasoning bounds a wide object.
const MAX_KEYS_PER_OBJECT = 16;

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
 * assumes well-formedness. JSON.parse keeps the last of two equal keys, which would let a child hide
 * a field from the checks, hence the duplicate-key refusal.
 */
export const rejectUnsafeStructure = (json: string): void => {
  // One entry per open container: the key set of an object, or null for an array.
  const containers: (Set<string> | null)[] = [];
  let expectKey = false;
  let index = 0;

  while (index < json.length) {
    const char = json[index];
    if (char === '"') {
      const end = endOfString(json, index);
      const keys = containers[containers.length - 1];
      if (expectKey && keys != null) {
        const key: unknown = JSON.parse(json.slice(index, end));
        if (typeof key !== 'string' || keys.has(key)) {
          throw new WireProtocolError('duplicate key in result');
        }
        if (keys.size >= MAX_KEYS_PER_OBJECT) {
          throw new WireProtocolError('result object has too many keys');
        }
        keys.add(key);
        expectKey = false;
      }
      index = end;
      continue;
    }
    if (char === '{' || char === '[') {
      if (containers.length >= MAX_DEPTH) {
        throw new WireProtocolError('result nesting is too deep');
      }
      containers.push(char === '{' ? new Set() : null);
      expectKey = char === '{';
    } else if (char === '}' || char === ']') {
      containers.pop();
      expectKey = false;
    } else if (char === ',') {
      expectKey = containers[containers.length - 1] != null;
    }
    index += 1;
  }
};
