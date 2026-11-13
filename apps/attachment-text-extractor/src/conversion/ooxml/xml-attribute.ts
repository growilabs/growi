// xml.sax.saxutils.quoteattr: escapes and quotes an attribute value,
// preferring single quotes when the value holds a double quote.
const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\n': '&#10;',
  '\r': '&#13;',
  '\t': '&#9;',
};

export const quoteAttribute = (value: string): string => {
  const escaped = value.replace(/[&<>\n\r\t]/g, (c) => ESCAPES[c] ?? c);
  if (!escaped.includes('"')) {
    return `"${escaped}"`;
  }
  return escaped.includes("'")
    ? `"${escaped.replaceAll('"', '&quot;')}"`
    : `'${escaped}'`;
};

/** The OOXML declaration the Python service writes on parts it builds. */
export const xmlDocument = (body: string): Buffer =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`,
    'utf8',
  );
