// Random Content-Disposition values for the parameter parser (research.md
// 16.3 `fuzz_params*`, rebuilt): "form-data" followed by "; key=value" pairs
// whose keys are the ones the parser treats specially (name, filename, the
// RFC 2231 forms, continuation numbers past 2^53, non-ASCII names) and whose
// values are fragments that stress Python's email-module quirks, sometimes
// quoted. A fixed seed keeps the samples unchanged; header-param-oracle.json
// holds what python-multipart's parse_options_header returned for each.
// Values are latin-1 strings, as a part header is read.

const KEYS: readonly string[] = [
  'name',
  'filename',
  'filename',
  'filename*',
  'filename*0',
  'filename*1',
  'filename*2',
  'filename*0*',
  'filename*1*',
  'filename*00',
  'filename*01',
  'filename*9007199254740992',
  'filename*9007199254740993',
  'filename*9007199254740992*',
  'name*',
  'xé*',
  'naïve',
  '__proto__',
  'Filename',
  'size',
];

const VALUE_FRAGMENTS: readonly string[] = [
  'a',
  'b',
  '.txt',
  '.pdf',
  'file',
  'a.txt',
  ' ',
  '\t',
  ';',
  '=',
  '"',
  '\\',
  '\\"',
  '\\\\',
  "'",
  '*',
  "UTF-8''",
  "utf-8'ja'",
  "''",
  '%41',
  '%E6%97%A5',
  '%0D%0A',
  '%zz',
  '%',
  '<',
  '>',
  '<a.txt>',
  'C:\\x\\a.txt',
  '\\\\srv\\a.txt',
  'dir/a.txt',
  '\x1c',
  '\x1f',
  '\x85',
  '\xa0',
  '\x0b',
  'é',
  '\xff',
];

const SEPARATORS: readonly string[] = ['; ', ';', ' ;', ';\t', '; \x85', ';;'];

/** mulberry32: a small seeded generator, so the samples never change. */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const HEADER_PARAM_SEED = 4242;
export const HEADER_PARAM_COUNT = 2000;

export const headerParamSamples = (
  seed: number = HEADER_PARAM_SEED,
  count: number = HEADER_PARAM_COUNT,
): readonly string[] => {
  const random = seeded(seed);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error('empty list');
    return item;
  };
  const value = (): string => {
    const raw = Array.from({ length: Math.floor(random() * 4) }, () =>
      pick(VALUE_FRAGMENTS),
    ).join('');
    return random() < 0.4 ? `"${raw}"` : raw;
  };
  const pair = (): string => {
    const roll = random();
    if (roll < 0.05) return value(); // a bare value without a key
    if (roll < 0.1) return pick(KEYS); // a key without "="
    return `${pick(KEYS)}=${value()}`;
  };
  return Array.from({ length: count }, () => {
    const pairs = 1 + Math.floor(random() * 4);
    return `form-data${Array.from({ length: pairs }, () => `${pick(SEPARATORS)}${pair()}`).join('')}`;
  });
};
