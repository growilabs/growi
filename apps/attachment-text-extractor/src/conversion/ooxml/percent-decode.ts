// urllib.parse.unquote: each run of ASCII characters is percent-decoded to
// bytes and read as UTF-8 with U+FFFD for bad bytes; anything else stays as
// it is. decodeURIComponent throws on '%zz' and on bad UTF-8 instead.
const ASCII_RUN = /[^\u0080-\uffff]+/g;
const ESCAPE = /%([0-9A-Fa-f]{2})/y;
const UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });

const runBytes = (run: string): Uint8Array => {
  const bytes: number[] = [];
  for (let i = 0; i < run.length; ) {
    ESCAPE.lastIndex = i;
    const hex = ESCAPE.exec(run);
    if (hex != null) {
      bytes.push(Number.parseInt(hex[1], 16));
      i += 3;
    } else {
      bytes.push(run.charCodeAt(i));
      i++;
    }
  }
  return Uint8Array.from(bytes);
};

export const unquote = (text: string): string =>
  text.includes('%')
    ? text.replace(ASCII_RUN, (run) =>
        run.includes('%') ? UTF8.decode(runBytes(run)) : run,
      )
    : text;
