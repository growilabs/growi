const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;

/**
 * The first `length` UTF-16 code units of `text`, one fewer when the cut
 * would split a surrogate pair: a lone surrogate is not valid Unicode.
 */
export const cutText = (text: string, length: number): string =>
  length > 0 && isHighSurrogate(text.charCodeAt(length - 1))
    ? text.slice(0, length - 1)
    : text.slice(0, length);
