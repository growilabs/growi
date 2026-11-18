import iconv from 'iconv-lite';

const ESCAPE_TO_JIS_X_0208 = [0x1b, 0x24, 0x42]; // ESC $ B
const ESCAPE_TO_ASCII = [0x1b, 0x28, 0x42]; // ESC ( B

// EUC-JP lead bytes of the JIS X 0208 rows; NEC row 13 and IBM extensions
// (e.g. ① and 髙) fall outside and are not ISO-2022-JP.
const isJisX0208 = (euc: Buffer): boolean =>
  euc.length === 2 &&
  ((euc[0] >= 0xa1 && euc[0] <= 0xa8) || (euc[0] >= 0xb0 && euc[0] <= 0xf4)) &&
  euc[1] >= 0xa1 &&
  euc[1] <= 0xfe;

const isAscii = (euc: Buffer): boolean => euc.length === 1 && euc[0] < 0x80;

const encodeCharacter = (char: string): { jis: boolean; bytes: number[] } => {
  const euc = iconv.encode(char, 'EUC-JP');
  // iconv-lite writes '?' for an unmappable character instead of failing.
  if (iconv.decode(euc, 'EUC-JP') !== char) {
    throw new Error(`not representable in ISO-2022-JP: ${char}`);
  }
  if (isJisX0208(euc)) {
    return { jis: true, bytes: [euc[0] & 0x7f, euc[1] & 0x7f] };
  }
  if (isAscii(euc)) {
    return { jis: false, bytes: [euc[0]] };
  }
  throw new Error(`not in JIS X 0208 or ASCII: ${char}`);
};

/**
 * iconv-lite cannot write ISO-2022-JP, so it is derived from EUC-JP. Unlike
 * Python's `iso2022_jp`, it refuses 8 characters Python writes (e.g. 〜 U+301C)
 * and writes 5 that Python refuses (e.g. ∥ U+2225); see research.md 9.7.
 */
export const encodeIso2022Jp = (text: string): Buffer => {
  const encoded = [...text].map(encodeCharacter);
  const bytes = encoded.flatMap(({ jis, bytes: charBytes }, i) => {
    const previousJis = i > 0 && encoded[i - 1].jis;
    if (jis === previousJis) {
      return charBytes;
    }
    return [...(jis ? ESCAPE_TO_JIS_X_0208 : ESCAPE_TO_ASCII), ...charBytes];
  });
  const endsInJis = encoded.length > 0 && encoded[encoded.length - 1].jis;
  return Buffer.from(endsInJis ? [...bytes, ...ESCAPE_TO_ASCII] : bytes);
};
