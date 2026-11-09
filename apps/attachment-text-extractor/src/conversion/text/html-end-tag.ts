// The rest of an end tag after its name, in the grammar of Python's
// html.parser (locatetagend): a quoted attribute value may hold ">", which
// htmlparser2 takes as the end of the tag.
const SEPARATORS = /[\t\n\r\f /]*/y;
const ATTRIBUTE =
  /(?<=['"\t\n\r\f /])[^\t\n\r\f />][^\t\n\r\f /=>]*(?:[\t\n\r\f ]*=[\t\n\r\f ]*(?:'[^']*'|"[^"]*"|(?!['"])[^>\t\n\r\f ]*))?[\t\n\r\f /]*/y;

const GREATER_THAN = 0x3e;

/**
 * Index of the ">" that ends, for Python, the end tag whose name ends at
 * nameEnd; -1 when Python's grammar never closes it. Attributes are read one
 * per exec: a single regex for all of them keeps a backtrack entry per
 * attribute and throws RangeError at about two million attributes.
 */
export const endTagGreaterThan = (markup: string, nameEnd: number): number => {
  SEPARATORS.lastIndex = nameEnd;
  SEPARATORS.test(markup);
  let at = SEPARATORS.lastIndex;
  ATTRIBUTE.lastIndex = at;
  while (ATTRIBUTE.test(markup)) {
    at = ATTRIBUTE.lastIndex;
  }
  return markup.charCodeAt(at) === GREATER_THAN ? at : -1;
};
