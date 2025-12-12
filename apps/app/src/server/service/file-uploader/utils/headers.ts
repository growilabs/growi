import type { Response } from 'express';

import type { ExpressHttpHeader } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';

type ContentHeaderField =
  | 'Content-Type'
  | 'Content-Security-Policy'
  | 'Content-Disposition'
  | 'Content-Length';
type ContentHeader = ExpressHttpHeader<ContentHeaderField>;

/**
 * Factory function to generate content headers.
 * This approach avoids creating a class instance for each call, improving memory efficiency.
 */
export const createContentHeaders = (
  attachment: IAttachmentDocument,
  opts?: { inline?: boolean },
): ContentHeader[] => {
  const headers: ContentHeader[] = [];

  // Content-Type
  headers.push({
    field: 'Content-Type',
    value: attachment.fileFormat,
  });

  // Content-Security-Policy
  headers.push({
    field: 'Content-Security-Policy',
    // eslint-disable-next-line max-len
    value:
      "script-src 'unsafe-hashes'; style-src 'self' 'unsafe-inline'; object-src 'none'; require-trusted-types-for 'script'; media-src 'self'; default-src 'none';",
  });

  // Content-Disposition
  headers.push({
    field: 'Content-Disposition',
    value: `${opts?.inline ? 'inline' : 'attachment'};filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
  });

  // Content-Length
  if (attachment.fileSize != null) {
    headers.push({
      field: 'Content-Length',
      value: attachment.fileSize.toString(),
    });
  }

  return headers;
};

export const getContentHeaderValue = (
  contentHeaders: ContentHeader[],
  field: ContentHeaderField,
): string | undefined => {
  const header = contentHeaders.find((h) => h.field === field);
  return header?.value.toString();
};

/**
 * Convert to ExpressHttpHeader[]
 */
export function toExpressHttpHeaders(
  records: Record<string, string | string[]>,
): ExpressHttpHeader[];
export function toExpressHttpHeaders(
  contentHeaders: ContentHeader[],
): ExpressHttpHeader[];
export function toExpressHttpHeaders(
  arg: Record<string, string | string[]> | ContentHeader[],
): ExpressHttpHeader[] {
  if (Array.isArray(arg)) {
    return (
      arg
        // exclude undefined
        .filter(
          (member): member is NonNullable<typeof member> => member != null,
        )
    );
  }

  return Object.entries(arg).map(([field, value]) => {
    return { field, value };
  });
}

export const applyHeaders = (
  res: Response,
  headers: ExpressHttpHeader[],
): void => {
  headers.forEach((header) => {
    res.header(header.field, header.value);
  });
};
