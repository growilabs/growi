import { decodeText } from './charset';
import { htmlDeclaredCharset } from './declared-in-head';
import { htmlMarkupToText } from './html-tokens';

export const htmlToText = (bytes: Uint8Array): string =>
  htmlMarkupToText(decodeText(bytes, htmlDeclaredCharset(bytes)));
