const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACKET = 0x5b;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACKET = 0x5d;
const CLOSE_BRACE = 0x7d;
const NON_FINITE_TOKENS = ['NaN', '-Infinity', 'Infinity'] as const;
// The deepest nesting Python's json.loads reads (measured on the service's
// Python 3.12); deeper input raises RecursionError there, and JSON.parse would
// instead build every level (about 50x the input in memory).
const PYTHON_MAX_NESTING = 9997;
// Pieces joined per batch, as in replaceBatched.
const BATCH_PIECES = 8192;

// Bracket depth outside strings, without pairing each closer with its opener:
// valid JSON closes in order, and invalid JSON is rejected either way.
const nestsDeeperThanPython = (text: string): boolean => {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === BACKSLASH) {
        i += 1;
      } else if (c === QUOTE) {
        inString = false;
      }
    } else if (c === QUOTE) {
      inString = true;
    } else if (c === OPEN_BRACKET || c === OPEN_BRACE) {
      depth += 1;
      if (depth > PYTHON_MAX_NESTING) {
        return true;
      }
    } else if (c === CLOSE_BRACKET || c === CLOSE_BRACE) {
      depth -= 1;
    }
  }
  return false;
};

// Python's json reads NaN, Infinity and -Infinity, which notebooks written by
// Python can hold; JSON.parse rejects them. They are replaced by null outside
// strings (only strings are read from a notebook), in one pass so that no
// input is scanned twice.
const nullNonFiniteTokens = (text: string): string => {
  const batches: string[] = [];
  let parts: string[] = [];
  let copiedTo = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === BACKSLASH) {
        i += 1;
      } else if (c === QUOTE) {
        inString = false;
      }
      continue;
    }
    if (c === QUOTE) {
      inString = true;
      continue;
    }
    const token = NON_FINITE_TOKENS.find((t) => text.startsWith(t, i));
    if (token !== undefined) {
      parts.push(text.slice(copiedTo, i), 'null');
      i += token.length - 1;
      copiedTo = i + 1;
      if (parts.length >= BATCH_PIECES) {
        batches.push(parts.join(''));
        parts = [];
      }
    }
  }
  parts.push(text.slice(copiedTo));
  batches.push(parts.join(''));
  return batches.join('');
};

const tryParse = (text: string): { readonly value: unknown } | null => {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) {
      return null;
    }
    throw error;
  }
};

/** The parsed JSON as Python's json.loads reads it, or undefined when it is not valid JSON. */
export const parseNotebookJson = (text: string): unknown => {
  if (nestsDeeperThanPython(text)) {
    return undefined;
  }
  const parsed =
    tryParse(text) ??
    (text.includes('NaN') || text.includes('Infinity')
      ? tryParse(nullNonFiniteTokens(text))
      : null);
  return parsed?.value;
};
