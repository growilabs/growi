import type { Response } from 'express';

import type { ExpressHttpHeader, IContentHeaders } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';


export class ContentHeaders implements IContentHeaders {

  contentType?: ExpressHttpHeader<'Content-Type'>;

  contentLength?: ExpressHttpHeader<'Content-Length'>;

  contentSecurityPolicy?: ExpressHttpHeader<'Content-Security-Policy'>;

  contentDisposition?: ExpressHttpHeader<'Content-Disposition'>;

  constructor(attachment: IAttachmentDocument, opts?: {
    inline?: boolean,
  }) {

    this.contentType = {
      field: 'Content-Type',
      value: attachment.fileFormat,
    };
    this.contentSecurityPolicy = {
      field: 'Content-Security-Policy',
      // eslint-disable-next-line max-len
      value: "script-src 'unsafe-hashes'; style-src 'self' 'unsafe-inline'; object-src 'none'; require-trusted-types-for 'script'; media-src 'self'; default-src 'none';",
    };
    this.contentDisposition = {
      field: 'Content-Disposition',
      value: `${opts?.inline ? 'inline' : 'attachment'};filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
    };

    if (attachment.fileSize) {
      this.contentLength = {
        field: 'Content-Length',
        value: attachment.fileSize.toString(),
      };
    }
  }

  /**
   * Convert to ExpressHttpHeader[]
   */
  toExpressHttpHeaders(): ExpressHttpHeader[] {
    return [
      this.contentType,
      this.contentLength,
      this.contentSecurityPolicy,
      this.contentDisposition,
    ]
      // exclude undefined
      .filter((member): member is NonNullable<typeof member> => member != null);
  }

}

/**
 * Convert Record to ExpressHttpHeader[]
 */
export const toExpressHttpHeaders = (records: Record<string, string | string[]>): ExpressHttpHeader[] => {
  return Object.entries(records).map(([field, value]) => { return { field, value } });
};

export const applyHeaders = (res: Response, headers: ExpressHttpHeader[]): void => {
  headers.forEach((header) => {
    res.header(header.field, header.value);
  });
};
