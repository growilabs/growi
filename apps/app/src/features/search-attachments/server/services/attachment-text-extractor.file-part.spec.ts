import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { AttachmentWithComputed } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { AttachmentTextExtractorService } from './attachment-text-extractor';

type ReceivedPart = {
  readonly headers: readonly string[];
  readonly content: Buffer;
};

const CRLF = Buffer.from('\r\n');
const HEADERS_END = Buffer.from('\r\n\r\n');

/** Splits a multipart body into its parts, byte for byte. */
const parseMultipart = (contentType: string, body: Buffer): ReceivedPart[] => {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const delimiter = Buffer.from(`--${boundary?.[1] ?? boundary?.[2]}`);
  const parts: ReceivedPart[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(
      start + delimiter.length + CRLF.length,
      next - CRLF.length,
    );
    const headersEnd = part.indexOf(HEADERS_END);
    parts.push({
      headers: part.subarray(0, headersEnd).toString('latin1').split('\r\n'),
      content: part.subarray(headersEnd + HEADERS_END.length),
    });
    start = next;
  }
  return parts;
};

// NUL, bytes that are not valid UTF-8, and a line break inside the content
const BINARY = Buffer.from([
  0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x0d, 0x0a, 0x2d,
  0x2d, 0x00,
]);

describe('AttachmentTextExtractorService request body', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map((s) => new Promise((r) => s.close(r))),
    );
  });

  /** Runs one extraction against a local server and returns the multipart parts it received. */
  const partsSentFor = async (
    attachment: Partial<AttachmentWithComputed>,
    stored: Buffer = BINARY,
  ): Promise<ReceivedPart[]> => {
    const received: { contentType: string; body: Buffer }[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({
          contentType: req.headers['content-type'] ?? '',
          body: Buffer.concat(chunks),
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            mimeType: 'text/plain',
            extractedCharacters: 0,
            pages: [],
          }),
        );
      });
    });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port),
      );
    });

    vi.spyOn(prisma.attachments, 'findUnique').mockResolvedValue(
      mock<AttachmentWithComputed>({
        id: 'a1',
        _id: 'a1',
        fileName: 'c0ffee.bin',
        fileSize: stored.length,
        ...attachment,
      }),
    );
    vi.spyOn(configManager, 'getConfig').mockImplementation(((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return `http://127.0.0.1:${port}`;
      if (key === 'app:attachmentFullTextSearch:extractorToken') return 'tok';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 5000;
      return undefined;
    }) as typeof configManager.getConfig);

    const service = new AttachmentTextExtractorService({
      // Arrives in several chunks, as a stored file does
      findDeliveryFile: async () =>
        Readable.from([stored.subarray(0, 5), stored.subarray(5)]),
    });
    const outcome = await service.extractAttachment('a1');

    expect(outcome.kind).toBe('success');
    expect(received).toHaveLength(1);
    return parseMultipart(received[0].contentType, received[0].body);
  };

  it('sends the stored bytes unchanged as a file part with a file name', async () => {
    const parts = await partsSentFor({
      originalName: 'report.pdf',
      fileFormat: 'application/pdf',
    });

    expect(parts).toHaveLength(1);
    expect(parts[0].headers).toEqual([
      'Content-Disposition: form-data; name="file"; filename="file.pdf"',
      'Content-Type: application/octet-stream',
    ]);
    expect(parts[0].content.equals(BINARY)).toBe(true);
  });

  it.each([
    ['a Japanese name', '日本語の資料 最終版.PDF', 'file.pdf'],
    ['a name with several dots', 'archive.2026.11.12.docx', 'file.docx'],
    ['a very long name', `${'あ'.repeat(5000)}.xlsx`, 'file.xlsx'],
    ['a Windows path', 'C:\\Users\\taro\\notes.txt', 'file.txt'],
    ['a name ending in a backslash', 'notes.txt\\', 'file'],
    ['an extension that is not letters and digits', 'a.p"df', 'file'],
    ['an over-long extension', `a.${'x'.repeat(17)}`, 'file'],
    ['a name without an extension', 'README', 'file'],
    ['an empty name', '', 'file'],
  ])('names the file part by the extension only for %s', async (_case, originalName, expected) => {
    const [filePart] = await partsSentFor({
      originalName,
      fileFormat: 'application/octet-stream',
    });

    expect(filePart.headers).toEqual([
      `Content-Disposition: form-data; name="file"; filename="${expected}"`,
      'Content-Type: application/octet-stream',
    ]);
    expect(filePart.content.equals(BINARY)).toBe(true);
  });

  it('falls back to the stored file name when the original name is missing', async () => {
    const [filePart] = await partsSentFor({
      originalName: null,
      fileName: 'c0ffee.pptx',
      fileFormat: 'application/octet-stream',
    });

    expect(filePart.headers[0]).toBe(
      'Content-Disposition: form-data; name="file"; filename="file.pptx"',
    );
  });

  it('keeps a hostile name and MIME type out of the part headers', async () => {
    const parts = await partsSentFor({
      originalName:
        'x"; filename="evil.html\r\nX-Injected: 1\r\n\r\n--boundary\r\n.docx',
      fileFormat: 'text/html\r\nX-Injected: 1',
    });

    expect(parts).toHaveLength(1);
    expect(parts[0].headers).toEqual([
      'Content-Disposition: form-data; name="file"; filename="file.docx"',
      'Content-Type: application/octet-stream',
    ]);
    expect(parts[0].content.equals(BINARY)).toBe(true);
  });

  it('keeps a very long stored MIME type out of the part headers', async () => {
    const parts = await partsSentFor({
      originalName: 'a.txt',
      fileFormat: `text/${'a'.repeat(5000)}`,
    });

    expect(parts).toHaveLength(1);
    expect(parts[0].headers).toEqual([
      'Content-Disposition: form-data; name="file"; filename="file.txt"',
      'Content-Type: application/octet-stream',
    ]);
  });

  it('sends no mimeType field when the name has an extension', async () => {
    // A browser on Windows with Excel reports a CSV as an Excel workbook
    const parts = await partsSentFor({
      originalName: 'members.csv',
      fileFormat: 'application/vnd.ms-excel',
    });

    expect(parts).toHaveLength(1);
  });

  it('sends the stored MIME type as the mimeType field when the name has no extension', async () => {
    const parts = await partsSentFor({
      originalName: 'README',
      fileFormat: 'text/plain',
    });

    expect(parts).toHaveLength(2);
    expect(parts[1].headers).toEqual([
      'Content-Disposition: form-data; name="mimeType"',
    ]);
    expect(parts[1].content.toString('utf8')).toBe('text/plain');
  });

  it('sends no mimeType field when no MIME type is stored', async () => {
    const parts = await partsSentFor({
      originalName: 'README',
      fileFormat: '',
    });

    expect(parts).toHaveLength(1);
  });

  it('maps a real 413 file_too_large answer to tooLarge', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({ code: 'file_too_large', message: 'File too large' }),
      );
    });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port),
      );
    });
    vi.spyOn(prisma.attachments, 'findUnique').mockResolvedValue(
      mock<AttachmentWithComputed>({
        id: 'a1',
        _id: 'a1',
        fileName: 'c0ffee.bin',
        originalName: 'report.pdf',
        fileFormat: 'application/pdf',
        fileSize: BINARY.length,
      }),
    );
    vi.spyOn(configManager, 'getConfig').mockImplementation(((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return `http://127.0.0.1:${port}`;
      if (key === 'app:attachmentFullTextSearch:extractorToken') return 'tok';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 5000;
      return undefined;
    }) as typeof configManager.getConfig);

    const service = new AttachmentTextExtractorService({
      findDeliveryFile: async () => Readable.from(BINARY),
    });

    expect(await service.extractAttachment('a1')).toEqual({
      kind: 'tooLarge',
      fileSize: BINARY.length,
    });
  });
});
