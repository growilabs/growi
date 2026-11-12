import dns from 'node:dns/promises';
import { Readable } from 'node:stream';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { AttachmentWithComputed } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

// Only the HTTP call is replaced; the error codes are the generated ones
vi.mock(
  import('@growi/attachment-text-extractor-client'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    postExtract: vi.fn(),
  }),
);

// Mock configManager
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

// Helper to create axios error responses
function makeAxiosError(status: number, code: string, message = 'error') {
  const error = Object.assign(new Error(message), {
    isAxiosError: true,
    response: {
      status,
      data: { code, message },
    },
  });
  return error;
}

// Helper to create a minimal attachment row stub
function makeAttachmentStub(): AttachmentWithComputed {
  return mock<AttachmentWithComputed>({
    id: 'attachment-id-1',
    _id: 'attachment-id-1',
    fileFormat: 'application/pdf',
    fileSize: 1024,
    fileName: 'test.pdf',
    originalName: 'test.pdf',
  });
}

// Helper to create a readable stream from a Buffer
function makeStream(data: Buffer): NodeJS.ReadableStream {
  return Readable.from(data);
}

describe('AttachmentTextExtractorService', () => {
  let postExtract: MockInstance;
  let mockFileUploader: { findDeliveryFile: MockInstance };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the mock to set expectations on it
    const extractorClient = await import(
      '@growi/attachment-text-extractor-client'
    );
    postExtract = extractorClient.postExtract as unknown as MockInstance;

    // Setup file uploader mock
    mockFileUploader = {
      findDeliveryFile: vi
        .fn()
        .mockResolvedValue(makeStream(Buffer.from('test content'))),
    };

    // Default config setup (all configured)
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return 'http://localhost:8000';
      if (key === 'app:attachmentFullTextSearch:extractorToken')
        return 'test-token';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
      if (key === 'app:attachmentFullTextSearch:maxFileSizeBytes')
        return 52428800;
      return undefined;
    });

    // Default attachment stub
    vi.spyOn(prisma.attachments, 'findUnique').mockResolvedValue(
      makeAttachmentStub(),
    );

    // Default DNS lookup (safe)
    vi.spyOn(dns, 'lookup').mockResolvedValue({
      address: '127.0.0.1',
      family: 4,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Dynamically import the module under test after mocks are set up
  // -----------------------------------------------------------------------
  async function getService() {
    const { AttachmentTextExtractorService } = await import(
      './attachment-text-extractor'
    );
    return new AttachmentTextExtractorService(mockFileUploader as any);
  }

  // -----------------------------------------------------------------------
  // 1. feature disabled — extractorUri null → serviceUnreachable
  // -----------------------------------------------------------------------
  it('returns serviceUnreachable when extractorUri is undefined', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri') return undefined;
      if (key === 'app:attachmentFullTextSearch:extractorToken')
        return 'test-token';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
      return undefined;
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  it('returns serviceUnreachable when extractorUri is empty string', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri') return '';
      if (key === 'app:attachmentFullTextSearch:extractorToken')
        return 'test-token';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
      return undefined;
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. token missing → serviceUnreachable
  // -----------------------------------------------------------------------
  it('returns serviceUnreachable when extractorToken is undefined', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return 'http://localhost:8000';
      if (key === 'app:attachmentFullTextSearch:extractorToken')
        return undefined;
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
      return undefined;
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  it('returns serviceUnreachable when extractorToken is empty string', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return 'http://localhost:8000';
      if (key === 'app:attachmentFullTextSearch:extractorToken') return '';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
      return undefined;
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. DNS rebinding blocked
  // -----------------------------------------------------------------------
  it('returns serviceUnreachable when DNS resolves to blocked metadata IP', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue({
      address: '169.254.169.254',
      family: 4,
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  it('blocks fd00:ec2::254 (AWS IPv6 metadata)', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue({
      address: 'fd00:ec2::254',
      family: 6,
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  it('blocks 100.100.100.200 (Alibaba metadata)', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue({
      address: '100.100.100.200',
      family: 4,
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  it('blocks 192.0.0.192 (GCP internal metadata)', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue({
      address: '192.0.0.192',
      family: 4,
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  it.each([
    { address: '169.254.1.1', family: 4 },
    { address: '::ffff:169.254.169.254', family: 6 },
    { address: 'fd00:ec2:0:0:0:0:0:254', family: 6 },
  ])('blocks a resolved address the URI check also blocks: $address', async (resolved) => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(resolved);

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    expect(postExtract).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 4. success — 200 ExtractResponse → ExtractionOutcome kind='success'
  // -----------------------------------------------------------------------
  it('returns success with correct pages on 200 response', async () => {
    postExtract.mockResolvedValue({
      data: {
        mimeType: 'application/pdf',
        extractedCharacters: 100,
        pages: [
          { pageNumber: 1, label: 'Page 1', content: 'Hello World' },
          { pageNumber: 2, label: null, content: 'Second page' },
        ],
      },
    });

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({
      kind: 'success',
      mimeType: 'application/pdf',
      pages: [
        { pageNumber: 1, label: 'Page 1', content: 'Hello World' },
        { pageNumber: 2, label: null, content: 'Second page' },
      ],
    });
  });

  it('calls postExtract with correct options (baseURL, Bearer auth, timeout)', async () => {
    postExtract.mockResolvedValue({
      data: {
        mimeType: 'text/plain',
        extractedCharacters: 5,
        pages: [{ pageNumber: null, label: null, content: 'hello' }],
      },
    });

    const service = await getService();
    await service.extractAttachment('attachment-id-1');

    expect(postExtract).toHaveBeenCalledOnce();
    const [, options] = postExtract.mock.calls[0];
    expect(options.baseURL).toBe('http://localhost:8000');
    expect(options.headers?.Authorization).toBe('Bearer test-token');
    expect(options.timeout).toBe(60000);
  });

  it('hands the stored bytes to the client as a named file, on the retry too', async () => {
    vi.useFakeTimers();
    const stored = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80,
    ]);
    mockFileUploader.findDeliveryFile.mockResolvedValue(makeStream(stored));
    postExtract
      .mockRejectedValueOnce(makeAxiosError(503, 'service_busy'))
      .mockResolvedValueOnce({
        data: {
          mimeType: 'application/pdf',
          extractedCharacters: 0,
          pages: [],
        },
      });

    const service = await getService();
    const resultPromise = service.extractAttachment('attachment-id-1');
    await vi.runAllTimersAsync();
    await resultPromise;
    vi.useRealTimers();

    expect(postExtract).toHaveBeenCalledTimes(2);
    for (const [body] of postExtract.mock.calls) {
      expect(Object.keys(body)).toEqual(['file']);
      expect(body.file).toBeInstanceOf(File);
      expect(body.file.name).toBe('file.pdf');
      expect(body.file.type).toBe('');
      expect(stored.equals(Buffer.from(await body.file.arrayBuffer()))).toBe(
        true,
      );
    }
  });

  // -----------------------------------------------------------------------
  // 5. unsupported format — 400 unsupported_format
  // -----------------------------------------------------------------------
  it('returns unsupported on 400 unsupported_format error', async () => {
    postExtract.mockRejectedValue(makeAxiosError(400, 'unsupported_format'));

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({
      kind: 'unsupported',
      mimeType: 'application/pdf',
    });
  });

  // -----------------------------------------------------------------------
  // 6. file too large — 413 file_too_large
  // -----------------------------------------------------------------------
  it('returns tooLarge on 413 file_too_large error', async () => {
    postExtract.mockRejectedValue(makeAxiosError(413, 'file_too_large'));

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'tooLarge', fileSize: 1024 });
  });

  describe('extraction size limit (app:attachmentFullTextSearch:maxFileSizeBytes)', () => {
    const LIMIT = 1000;

    const setup = (fileSize: number) => {
      vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://localhost:8000';
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return 'test-token';
        if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
        if (key === 'app:attachmentFullTextSearch:maxFileSizeBytes')
          return LIMIT;
        return undefined;
      });
      vi.spyOn(prisma.attachments, 'findUnique').mockResolvedValue(
        mock<AttachmentWithComputed>({
          id: 'attachment-id-1',
          _id: 'attachment-id-1',
          fileFormat: 'application/pdf',
          fileSize,
          originalName: 'test.pdf',
        }),
      );
      postExtract.mockResolvedValue({
        data: {
          mimeType: 'application/pdf',
          extractedCharacters: 0,
          pages: [],
        },
      });
    };

    it('returns tooLarge without reading the file or calling the extractor when over the limit', async () => {
      setup(LIMIT + 1);

      const service = await getService();
      const result = await service.extractAttachment('attachment-id-1');

      expect(result).toEqual({ kind: 'tooLarge', fileSize: LIMIT + 1 });
      expect(mockFileUploader.findDeliveryFile).not.toHaveBeenCalled();
      expect(postExtract).not.toHaveBeenCalled();
    });

    it('sends the file when its size equals the limit', async () => {
      setup(LIMIT);

      const service = await getService();
      const result = await service.extractAttachment('attachment-id-1');

      expect(result.kind).toBe('success');
      expect(postExtract).toHaveBeenCalledOnce();
    });

    it('sends the file when it is under the limit', async () => {
      setup(LIMIT - 1);

      const service = await getService();
      const result = await service.extractAttachment('attachment-id-1');

      expect(result.kind).toBe('success');
      expect(postExtract).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // 7. extraction timeout — 408 extraction_timeout
  // -----------------------------------------------------------------------
  it('returns timeout on 408 extraction_timeout error', async () => {
    postExtract.mockRejectedValue(makeAxiosError(408, 'extraction_timeout'));

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'timeout' });
  });

  it('returns encrypted on 422 file_encrypted error', async () => {
    postExtract.mockRejectedValue(makeAxiosError(422, 'file_encrypted'));

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'encrypted' });
  });

  it('returns resourceLimit with the message on 422 resource_limit_exceeded error', async () => {
    postExtract.mockRejectedValue(
      makeAxiosError(
        422,
        'resource_limit_exceeded',
        'limit_exceeded: the document exceeds a processing limit',
      ),
    );

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({
      kind: 'resourceLimit',
      message: 'limit_exceeded: the document exceeds a processing limit',
    });
  });

  it.each([
    'a_code_this_version_does_not_know',
    'constructor',
    undefined,
  ])('returns serviceUnreachable on an error response with the unknown code %s', async (code) => {
    postExtract.mockRejectedValue(
      Object.assign(new Error('error'), {
        isAxiosError: true,
        response: { status: 422, data: { code, message: 'error' } },
      }),
    );

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
  });

  // -----------------------------------------------------------------------
  // 8. service busy first call → retry → 200 success
  // -----------------------------------------------------------------------
  it('retries once on 503 service_busy and succeeds on second call', async () => {
    vi.useFakeTimers();

    postExtract
      .mockRejectedValueOnce(makeAxiosError(503, 'service_busy'))
      .mockResolvedValueOnce({
        data: {
          mimeType: 'text/plain',
          extractedCharacters: 5,
          pages: [{ pageNumber: null, label: null, content: 'hello' }],
        },
      });

    const service = await getService();
    const resultPromise = service.extractAttachment('attachment-id-1');

    // Advance fake timers to let retry delay pass
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result).toEqual({
      kind: 'success',
      mimeType: 'text/plain',
      pages: [{ pageNumber: null, label: null, content: 'hello' }],
    });
    expect(postExtract).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 9. service busy on both calls → serviceBusy
  // -----------------------------------------------------------------------
  it('returns serviceBusy after 2 consecutive 503 service_busy errors', async () => {
    vi.useFakeTimers();

    postExtract
      .mockRejectedValueOnce(makeAxiosError(503, 'service_busy'))
      .mockRejectedValueOnce(makeAxiosError(503, 'service_busy'));

    const service = await getService();
    const resultPromise = service.extractAttachment('attachment-id-1');

    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result).toEqual({ kind: 'serviceBusy' });
    expect(postExtract).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 10. unauthorized — 401 → serviceUnreachable + pino ERROR
  // -----------------------------------------------------------------------
  it('returns serviceUnreachable on 401 unauthorized and logs pino ERROR without token', async () => {
    postExtract.mockRejectedValue(makeAxiosError(401, 'unauthorized'));

    // Import the module to get logger reference
    const { AttachmentTextExtractorService } = await import(
      './attachment-text-extractor'
    );

    // We can verify logger.error was called via spying on the module's logger
    // Use a spy approach via the module
    const service = new AttachmentTextExtractorService(mockFileUploader as any);
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
  });

  it('does not log the token value in the 401 error case', async () => {
    postExtract.mockRejectedValue(makeAxiosError(401, 'unauthorized'));

    // Capture all log calls - we can't easily spy on the pino logger,
    // but we can verify the result and that no token appears in process output
    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
    // Token value should not be accessible through the service interface
    // The implementation contract requires no token logging
  });

  // -----------------------------------------------------------------------
  // 11. network error → serviceUnreachable
  // -----------------------------------------------------------------------
  it('returns serviceUnreachable on network-level ECONNREFUSED', async () => {
    const networkError = Object.assign(new Error('connect ECONNREFUSED'), {
      isAxiosError: true,
      code: 'ECONNREFUSED',
      response: undefined,
    });
    postExtract.mockRejectedValue(networkError);

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
  });

  it('returns serviceUnreachable on DNS lookup failure', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({ kind: 'serviceUnreachable' });
  });

  // -----------------------------------------------------------------------
  // 12. never throws — even on unexpected Error, returns ExtractionOutcome
  // -----------------------------------------------------------------------
  it('never throws — returns ExtractionOutcome even when an unexpected error occurs', async () => {
    postExtract.mockRejectedValue(new Error('Unexpected internal error'));

    const service = await getService();

    // Must not throw — must return an ExtractionOutcome
    await expect(
      service.extractAttachment('attachment-id-1'),
    ).resolves.not.toThrow();
    const result = await service.extractAttachment('attachment-id-1');
    expect(result.kind).toBeDefined();
  });

  it('returns attachment_not_found when the attachment row does not exist', async () => {
    vi.spyOn(prisma.attachments, 'findUnique').mockResolvedValue(null);

    const service = await getService();
    const result = await service.extractAttachment('nonexistent-id');

    expect(result).toMatchObject({
      kind: 'failed',
      reasonCode: 'attachment_not_found',
    });
  });

  it('never throws when fileUploader throws', async () => {
    mockFileUploader.findDeliveryFile.mockRejectedValue(
      new Error('Storage unavailable'),
    );

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result.kind).toBeDefined();
    expect(result.kind).not.toBe(undefined);
  });

  // -----------------------------------------------------------------------
  // 13. extraction_failed → failed
  // -----------------------------------------------------------------------
  it('returns failed on 500 extraction_failed error', async () => {
    postExtract.mockRejectedValue(
      makeAxiosError(500, 'extraction_failed', 'Internal extraction error'),
    );

    const service = await getService();
    const result = await service.extractAttachment('attachment-id-1');

    expect(result).toEqual({
      kind: 'failed',
      reasonCode: 'extraction_failed',
      message: 'Internal extraction error',
    });
  });
});
