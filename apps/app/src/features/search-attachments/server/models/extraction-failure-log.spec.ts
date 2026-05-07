import { describe, expect, it } from 'vitest';

import {
  EXTRACTION_FAILURE_LOG_TTL_SECONDS,
  ExtractionFailureLog,
  ExtractionFailureReasonCode,
} from './extraction-failure-log';

describe('ExtractionFailureReasonCode', () => {
  it('contains all required reason codes', () => {
    expect(ExtractionFailureReasonCode.unsupportedFormat).toBe(
      'unsupportedFormat',
    );
    expect(ExtractionFailureReasonCode.fileTooLarge).toBe('fileTooLarge');
    expect(ExtractionFailureReasonCode.extractionTimeout).toBe(
      'extractionTimeout',
    );
    expect(ExtractionFailureReasonCode.serviceBusy).toBe('serviceBusy');
    expect(ExtractionFailureReasonCode.serviceUnreachable).toBe(
      'serviceUnreachable',
    );
    expect(ExtractionFailureReasonCode.extractionFailed).toBe(
      'extractionFailed',
    );
  });

  it('has exactly 6 reason codes', () => {
    expect(Object.keys(ExtractionFailureReasonCode)).toHaveLength(6);
  });
});

describe('EXTRACTION_FAILURE_LOG_TTL_SECONDS', () => {
  it('equals 90 days in seconds', () => {
    const ninetyDaysInSeconds = 60 * 60 * 24 * 90;
    expect(EXTRACTION_FAILURE_LOG_TTL_SECONDS).toBe(ninetyDaysInSeconds);
    expect(EXTRACTION_FAILURE_LOG_TTL_SECONDS).toBe(7776000);
  });
});

describe('ExtractionFailureLog schema', () => {
  const schema = ExtractionFailureLog.schema;

  it('has attachmentId field as String', () => {
    const field = schema.path('attachmentId');
    expect(field).toBeDefined();
    expect(field.instance).toBe('String');
  });

  it('has pageId field as String', () => {
    const field = schema.path('pageId');
    expect(field).toBeDefined();
    expect(field.instance).toBe('String');
  });

  it('has fileName field as String', () => {
    const field = schema.path('fileName');
    expect(field).toBeDefined();
    expect(field.instance).toBe('String');
  });

  it('has fileFormat field as String', () => {
    const field = schema.path('fileFormat');
    expect(field).toBeDefined();
    expect(field.instance).toBe('String');
  });

  it('has fileSize field as Number', () => {
    const field = schema.path('fileSize');
    expect(field).toBeDefined();
    expect(field.instance).toBe('Number');
  });

  it('has reasonCode field as String with enum values', () => {
    const field = schema.path('reasonCode') as any;
    expect(field).toBeDefined();
    expect(field.instance).toBe('String');
    expect(field.enumValues).toEqual(
      expect.arrayContaining([
        'unsupportedFormat',
        'fileTooLarge',
        'extractionTimeout',
        'serviceBusy',
        'serviceUnreachable',
        'extractionFailed',
      ]),
    );
    expect(field.enumValues).toHaveLength(6);
  });

  it('has message field as String', () => {
    const field = schema.path('message');
    expect(field).toBeDefined();
    expect(field.instance).toBe('String');
  });

  it('has occurredAt field as Date', () => {
    const field = schema.path('occurredAt');
    expect(field).toBeDefined();
    expect(field.instance).toBe('Date');
  });

  it('has retentionGroupHash field as String', () => {
    const field = schema.path('retentionGroupHash');
    expect(field).toBeDefined();
    expect(field.instance).toBe('String');
  });

  it('has a TTL index on occurredAt with 90-day expiry', () => {
    // schema.indexes() returns [fields, options][] at runtime.
    // The Mongoose type declaration is inaccurate (Record<string, IndexDirection>),
    // so we cast through unknown to access the real tuple structure.
    type IndexEntry = [Record<string, unknown>, Record<string, unknown>];
    const indexes = schema.indexes() as unknown as IndexEntry[];

    // Find the index on occurredAt that has expireAfterSeconds
    const ttlIndex = indexes.find((indexDef) => {
      return (
        'occurredAt' in indexDef[0] &&
        indexDef[1].expireAfterSeconds !== undefined
      );
    });

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex![0]).toEqual({ occurredAt: 1 });
    expect(ttlIndex![1].expireAfterSeconds).toBe(7776000);
  });
});
