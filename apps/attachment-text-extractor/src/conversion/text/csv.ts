import { convertOffice } from '../office';
import { decodeText } from './charset';

// anydoc reads UTF-8 only and detects the delimiter (comma or tab) itself.
export const csvToText = (bytes: Uint8Array): Promise<string> =>
  convertOffice(Buffer.from(decodeText(bytes), 'utf8'), 'csv');
