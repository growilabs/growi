/**
 * Compile-time type tests for attachment-search interfaces.
 * These tests verify the shape of all exported types/interfaces
 * by attempting to assign conformant values using the `satisfies` operator.
 * A TypeScript compile error means the interface definition is incorrect.
 */

import type {
  AttachmentSearchConfig,
  AttachmentSearchConfigUpdate,
  ExtractedPage,
  ExtractionFailureEntry,
  ExtractionOutcome,
  IAttachmentEsDoc,
  IAttachmentHit,
  IPrimarySearchResult,
  ISecondarySearchResult,
  ISnippetSegment,
} from './attachment-search';
// Verify the module exists at runtime (not just types)
import * as AttachmentSearchModule from './attachment-search';

describe('module existence', () => {
  test('attachment-search module is importable', () => {
    // The module must exist for this import to succeed at runtime
    expect(AttachmentSearchModule).toBeDefined();
  });
});

// ---- ISnippetSegment ----

describe('ISnippetSegment', () => {
  test('accepts valid shape', () => {
    const seg: ISnippetSegment = {
      text: 'hello world',
      highlighted: true,
    };
    expect(seg.text).toBe('hello world');
    expect(seg.highlighted).toBe(true);
  });
});

// ---- ExtractedPage ----

describe('ExtractedPage', () => {
  test('accepts shape with all fields', () => {
    const page: ExtractedPage = {
      pageNumber: 1,
      label: 'Page 1',
      content: 'body text',
    };
    expect(page.pageNumber).toBe(1);
  });

  test('accepts shape with nullable fields', () => {
    const page: ExtractedPage = {
      pageNumber: null,
      label: null,
      content: 'body text',
    };
    expect(page.pageNumber).toBeNull();
    expect(page.label).toBeNull();
  });
});

// ---- ExtractionOutcome discriminated union ----

describe('ExtractionOutcome', () => {
  test('kind=success is assignable', () => {
    const outcome: ExtractionOutcome = {
      kind: 'success',
      pages: [{ pageNumber: 1, label: 'p1', content: 'text' }],
      mimeType: 'application/pdf',
    };
    expect(outcome.kind).toBe('success');
  });

  test('kind=unsupported is assignable', () => {
    const outcome: ExtractionOutcome = {
      kind: 'unsupported',
      mimeType: 'image/tiff',
    };
    expect(outcome.kind).toBe('unsupported');
  });

  test('kind=tooLarge is assignable', () => {
    const outcome: ExtractionOutcome = {
      kind: 'tooLarge',
      fileSize: 1048576,
    };
    expect(outcome.kind).toBe('tooLarge');
  });

  test('kind=timeout is assignable', () => {
    const outcome: ExtractionOutcome = { kind: 'timeout' };
    expect(outcome.kind).toBe('timeout');
  });

  test('kind=serviceBusy is assignable', () => {
    const outcome: ExtractionOutcome = { kind: 'serviceBusy' };
    expect(outcome.kind).toBe('serviceBusy');
  });

  test('kind=serviceUnreachable is assignable', () => {
    const outcome: ExtractionOutcome = { kind: 'serviceUnreachable' };
    expect(outcome.kind).toBe('serviceUnreachable');
  });

  test('kind=failed is assignable', () => {
    const outcome: ExtractionOutcome = {
      kind: 'failed',
      reasonCode: 'SOME_CODE',
      message: 'something went wrong',
    };
    expect(outcome.kind).toBe('failed');
  });

  test('discriminated union allows narrowing', () => {
    const isSuccess = (
      o: ExtractionOutcome,
    ): o is Extract<ExtractionOutcome, { kind: 'success' }> =>
      o.kind === 'success';

    const outcome: ExtractionOutcome = {
      kind: 'success',
      pages: [],
      mimeType: 'text/plain',
    };

    if (isSuccess(outcome)) {
      // TypeScript should allow .pages and .mimeType here
      expect(outcome.pages).toBeDefined();
      expect(outcome.mimeType).toBe('text/plain');
    }
  });
});

// ---- IAttachmentHit ----

describe('IAttachmentHit', () => {
  test('accepts valid shape', () => {
    const hit: IAttachmentHit = {
      attachmentId: 'att-001',
      pageId: 'page-001',
      fileName: 'report.pdf',
      originalName: 'Annual Report.pdf',
      fileFormat: 'application/pdf',
      fileSize: 204800,
      snippets: [{ text: 'summary', highlighted: false }],
      pageNumber: 3,
      label: 'Page 3',
    };
    expect(hit.attachmentId).toBe('att-001');
  });

  test('accepts nullable pageNumber and label', () => {
    const hit: IAttachmentHit = {
      attachmentId: 'att-002',
      pageId: 'page-002',
      fileName: 'notes.txt',
      originalName: 'notes.txt',
      fileFormat: 'text/plain',
      fileSize: 1024,
      snippets: [],
      pageNumber: null,
      label: null,
    };
    expect(hit.pageNumber).toBeNull();
    expect(hit.label).toBeNull();
  });
});

// ---- IAttachmentEsDoc ----

describe('IAttachmentEsDoc', () => {
  test('accepts valid shape', () => {
    const doc: IAttachmentEsDoc = {
      attachmentId: 'att-001',
      pageId: 'page-001',
      pageNumber: 1,
      label: 'Page 1',
      fileName: 'report.pdf',
      originalName: 'Annual Report.pdf',
      fileFormat: 'application/pdf',
      fileSize: 204800,
      attachmentType: 'pdf',
      content: 'extracted text content',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    };
    expect(doc.attachmentId).toBe('att-001');
  });

  test('accepts nullable pageNumber and label', () => {
    const doc: IAttachmentEsDoc = {
      attachmentId: 'att-002',
      pageId: 'page-002',
      pageNumber: null,
      label: null,
      fileName: 'doc.txt',
      originalName: 'doc.txt',
      fileFormat: 'text/plain',
      fileSize: 512,
      attachmentType: 'text',
      content: 'hello',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    expect(doc.pageNumber).toBeNull();
  });
});

// ---- ExtractionFailureEntry ----

describe('ExtractionFailureEntry', () => {
  test('accepts all valid reasonCode values', () => {
    const entries: ExtractionFailureEntry[] = [
      {
        attachmentId: 'att-001',
        pageId: 'page-001',
        fileName: 'file.zip',
        fileFormat: 'application/zip',
        fileSize: 1024,
        reasonCode: 'unsupportedFormat',
        message: null,
        occurredAt: new Date(),
      },
      {
        attachmentId: 'att-002',
        pageId: null,
        fileName: 'big.pdf',
        fileFormat: 'application/pdf',
        fileSize: 999999999,
        reasonCode: 'fileTooLarge',
        message: 'exceeds limit',
        occurredAt: new Date(),
      },
      {
        attachmentId: 'att-003',
        pageId: 'page-003',
        fileName: 'slow.docx',
        fileFormat:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileSize: 50000,
        reasonCode: 'extractionTimeout',
        message: null,
        occurredAt: new Date(),
      },
      {
        attachmentId: 'att-004',
        pageId: 'page-004',
        fileName: 'busy.txt',
        fileFormat: 'text/plain',
        fileSize: 100,
        reasonCode: 'serviceBusy',
        message: null,
        occurredAt: new Date(),
      },
      {
        attachmentId: 'att-005',
        pageId: 'page-005',
        fileName: 'unreachable.txt',
        fileFormat: 'text/plain',
        fileSize: 100,
        reasonCode: 'serviceUnreachable',
        message: 'connection refused',
        occurredAt: new Date(),
      },
      {
        attachmentId: 'att-006',
        pageId: 'page-006',
        fileName: 'corrupt.pdf',
        fileFormat: 'application/pdf',
        fileSize: 200,
        reasonCode: 'extractionFailed',
        message: 'parse error',
        occurredAt: new Date(),
      },
    ];
    expect(entries).toHaveLength(6);
  });
});

// ---- IPrimarySearchResult ----

describe('IPrimarySearchResult', () => {
  test('accepts valid shape', () => {
    const result: IPrimarySearchResult = {
      items: [
        {
          pageId: 'page-001',
          attachmentHits: [
            {
              attachmentId: 'att-001',
              pageId: 'page-001',
              fileName: 'doc.pdf',
              originalName: 'Document.pdf',
              fileFormat: 'application/pdf',
              fileSize: 1024,
              snippets: [],
              pageNumber: null,
              label: null,
            },
          ],
        },
      ],
      meta: {
        total: 1,
        hitsCount: 1,
        took: 5,
        primaryResultIncomplete: false,
        nextCursor: null,
      },
    };
    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  test('accepts nextCursor as string', () => {
    const result: IPrimarySearchResult = {
      items: [],
      meta: {
        total: 100,
        hitsCount: 10,
        took: 12,
        primaryResultIncomplete: true,
        nextCursor: 'cursor-abc-123',
      },
    };
    expect(result.meta.nextCursor).toBe('cursor-abc-123');
  });
});

// ---- ISecondarySearchResult ----

describe('ISecondarySearchResult', () => {
  test('accepts valid shape', () => {
    const result: ISecondarySearchResult = {
      attachmentHitsByPageId: {
        'page-001': [
          {
            attachmentId: 'att-001',
            pageId: 'page-001',
            fileName: 'doc.pdf',
            originalName: 'Document.pdf',
            fileFormat: 'application/pdf',
            fileSize: 1024,
            snippets: [],
            pageNumber: null,
            label: null,
          },
        ],
      },
    };
    expect(Object.keys(result.attachmentHitsByPageId)).toHaveLength(1);
  });

  test('accepts empty record', () => {
    const result: ISecondarySearchResult = {
      attachmentHitsByPageId: {},
    };
    expect(result.attachmentHitsByPageId).toEqual({});
  });
});

// ---- AttachmentSearchConfig ----

describe('AttachmentSearchConfig', () => {
  test('accepts valid shape with all fields defined', () => {
    const config: AttachmentSearchConfig = {
      extractorUri: 'http://localhost:8000',
      hasExtractorToken: true,
      timeoutMs: 30000,
      maxFileSizeBytes: 52428800,
      isAttachmentFullTextSearchEnabled: true,
      requiresReindex: false,
    };
    expect(config.extractorUri).toBe('http://localhost:8000');
  });

  test('accepts extractorUri as undefined', () => {
    const config: AttachmentSearchConfig = {
      extractorUri: undefined,
      hasExtractorToken: false,
      timeoutMs: 30000,
      maxFileSizeBytes: 52428800,
      isAttachmentFullTextSearchEnabled: false,
      requiresReindex: false,
    };
    expect(config.extractorUri).toBeUndefined();
  });
});

// ---- AttachmentSearchConfigUpdate ----

describe('AttachmentSearchConfigUpdate', () => {
  test('accepts empty object (all fields optional)', () => {
    const update: AttachmentSearchConfigUpdate = {};
    expect(update).toBeDefined();
  });

  test('accepts partial update with extractorUri null', () => {
    const update: AttachmentSearchConfigUpdate = {
      extractorUri: null,
    };
    expect(update.extractorUri).toBeNull();
  });

  test('accepts full update', () => {
    const update: AttachmentSearchConfigUpdate = {
      extractorUri: 'http://extractor:8000',
      extractorToken: 'secret-token',
      timeoutMs: 60000,
      maxFileSizeBytes: 104857600,
    };
    expect(update.timeoutMs).toBe(60000);
  });
});
